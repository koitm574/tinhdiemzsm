begin;

-- Match the existing centisecond input rules, including compact input such as 10704.
create function zsm_private.parse_time(raw text)
returns bigint language plpgsql immutable set search_path = '' as $$
declare value text := btrim(coalesce(raw, '')); parts text[]; digits integer;
  minutes numeric := 0; seconds numeric := 0; cents numeric := 0; result numeric;
begin
  if value = '' or upper(value) = 'X' or char_length(value) > 64
     or value !~ '^[0-9:.,]+$' then return null; end if;
  if value ~ '[:.,]' then
    parts := regexp_split_to_array(regexp_replace(value, ',', '.'), '[:.]');
    if exists (select 1 from unnest(parts) item where item !~ '^[0-9]+$') then return null; end if;
    if array_length(parts, 1) = 3 then
      minutes := parts[1]::numeric; seconds := parts[2]::numeric; cents := parts[3]::numeric;
    elsif array_length(parts, 1) = 2 then
      seconds := parts[1]::numeric; cents := parts[2]::numeric;
    else return null; end if;
  else
    digits := char_length(value);
    if digits >= 5 then
      minutes := left(value, digits - 4)::numeric;
      seconds := substring(value from digits - 3 for 2)::numeric;
      cents := right(value, 2)::numeric;
    elsif digits >= 3 then
      seconds := left(value, digits - 2)::numeric; cents := right(value, 2)::numeric;
    else cents := value::numeric; end if;
  end if;
  result := minutes * 60000 + seconds * 1000 + cents * 10;
  if result < 0 or result > 9007199254740991 then return null; end if;
  return result::bigint;
end;
$$;

create function zsm_private.is_final_time(raw text)
returns boolean language sql immutable set search_path = '' as $$
  select upper(btrim(coalesce(raw, ''))) = 'X' or
    (btrim(coalesce(raw, '')) ~ '^[0-9]+:[0-9]{2}[.][0-9]{2}$' and zsm_private.parse_time(raw) is not null);
$$;

create function zsm_private.final_winner(t1 text, t2 text)
returns integer language plpgsql immutable set search_path = '' as $$
declare v1 bigint; v2 bigint;
begin
  if not zsm_private.is_final_time(t1) or not zsm_private.is_final_time(t2) then return -1; end if;
  v1 := zsm_private.parse_time(t1); v2 := zsm_private.parse_time(t2);
  if v1 is null and v2 is null then return -1; end if;
  if v1 is null then return 1; end if;
  if v2 is null then return 0; end if;
  if v1 < v2 then return 0; elsif v2 < v1 then return 1; else return -1; end if;
end;
$$;

create function public.zsm_calculate(
  p_player_count integer, p_games jsonb, p_mode text, p_match_bo integer, p_set_bo integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  access_status text; game_count integer; game_index integer; player_index integer;
  game jsonb; times jsonb; slot jsonb; values_ms bigint[]; best bigint; value_ms bigint;
  king_index integer; is_king boolean; is_best boolean; score integer; game_scores jsonb;
  scores jsonb := '[]'; assignments jsonb := '[]'; maps12 jsonb := '[]'; maps3 jsonb := '[]';
  sets jsonb := '[]'; counted jsonb := '[]'; match_status jsonb := null;
  set_number integer; round_number integer; p1_sets integer := 0; p2_sets integer := 0;
  p1_rounds integer := 0; p2_rounds integer := 0; current_set integer := 1;
  winner integer := -1; result integer; finished boolean;
  last_index integer; last_winner integer; win_condition integer; match_condition integer;
begin
  -- Check the current row on every calculation, including tabs with an older JWT.
  select status into access_status from public.zsm_profiles where id = auth.uid() for share;
  if access_status is distinct from 'approved' then
    raise exception 'APPROVAL_REQUIRED' using errcode = '42501';
  end if;
  if p_player_count is null or p_player_count < 2 or p_player_count > 6
     or p_mode is null or p_mode not in ('solo', '1v1', '2v2', '3v3')
     or p_match_bo is null or p_match_bo not in (1, 3)
     or p_set_bo is null or p_set_bo not in (7, 9, 11, 13)
     or (p_mode = '1v1' and p_player_count <> 2)
     or p_games is null or jsonb_typeof(p_games) <> 'array' then
    raise exception 'INVALID_CALCULATION_INPUT' using errcode = '22023';
  end if;
  game_count := jsonb_array_length(p_games);
  if game_count < 1 or game_count > 90 or octet_length(p_games::text) > 200000 then
    raise exception 'INVALID_GAME_COUNT_OR_SIZE' using errcode = '22023';
  end if;
  for game_index in 0..game_count - 1 loop
    game := p_games -> game_index; times := game -> 'times';
    if jsonb_typeof(game) is distinct from 'object' or jsonb_typeof(times) is distinct from 'array' then
      raise exception 'INVALID_GAME' using errcode = '22023';
    end if;
    if jsonb_array_length(times) < p_player_count or jsonb_array_length(times) > 6
       or jsonb_typeof(game -> 'mapId') is distinct from 'string' then
      raise exception 'INVALID_GAME_SLOTS' using errcode = '22023';
    end if;
    for slot in select value from jsonb_array_elements(times) loop
      if jsonb_typeof(slot) <> 'string' then raise exception 'INVALID_TIME' using errcode = '22023'; end if;
    end loop;
    assignments := assignments || jsonb_build_array(jsonb_build_object('set', game_index / p_set_bo + 1, 'round', game_index % p_set_bo + 1));
    if coalesce(game ->> 'mapId', '') <> '' then
      if game_index / p_set_bo + 1 < 3 then maps12 := maps12 || jsonb_build_array(game ->> 'mapId');
      else maps3 := maps3 || jsonb_build_array(game ->> 'mapId'); end if;
    end if;
  end loop;

  if p_mode = '1v1' then
    win_condition := (p_set_bo + 1) / 2; match_condition := (p_match_bo + 1) / 2;
    for set_number in 1..p_match_bo loop
      p1_rounds := 0; p2_rounds := 0; finished := false; last_index := -1; last_winner := -1;
      for round_number in 0..p_set_bo - 1 loop
        game_index := (set_number - 1) * p_set_bo + round_number;
        if game_index >= game_count then continue; end if;
        times := p_games -> game_index -> 'times';
        if not zsm_private.is_final_time(times ->> 0) or not zsm_private.is_final_time(times ->> 1) then continue; end if;
        result := zsm_private.final_winner(times ->> 0, times ->> 1);
        counted := counted || jsonb_build_array(game_index); last_index := game_index; last_winner := result;
        if result = 0 then p1_rounds := p1_rounds + 1; end if;
        if result = 1 then p2_rounds := p2_rounds + 1; end if;
        if p1_rounds >= win_condition or p2_rounds >= win_condition then finished := true; exit; end if;
      end loop;
      current_set := set_number;
      sets := sets || jsonb_build_array(jsonb_build_object('set', set_number,
        'p1Rounds', p1_rounds, 'p2Rounds', p2_rounds, 'finished', finished,
        'lastGameIndex', last_index, 'lastWinner', last_winner));
      if not finished then exit; end if;
      if p1_rounds >= win_condition then p1_sets := p1_sets + 1; else p2_sets := p2_sets + 1; end if;
      if p1_sets >= match_condition or p2_sets >= match_condition then
        winner := case when p1_sets >= match_condition then 0 else 1 end; exit;
      end if;
    end loop;
    match_status := jsonb_build_object('p1Sets', p1_sets, 'p2Sets', p2_sets,
      'p1Rounds', p1_rounds, 'p2Rounds', p2_rounds, 'currentSet', current_set,
      'winner', winner, 'isFinished', winner <> -1, 'sets', sets, 'countedGames', counted,
      'gameAssignments', assignments, 'mapsUsedSet12', maps12, 'mapsUsedSet3', maps3);
  end if;

  for game_index in 0..game_count - 1 loop
    times := p_games -> game_index -> 'times'; values_ms := array[]::bigint[]; best := null;
    for player_index in 0..p_player_count - 1 loop
      value_ms := zsm_private.parse_time(times ->> player_index);
      values_ms := array_append(values_ms, value_ms);
      if value_ms is not null and (best is null or value_ms < best) then best := value_ms; end if;
    end loop;
    game_scores := '[]';
    for player_index in 0..p_player_count - 1 loop
      value_ms := values_ms[player_index + 1];
      if p_mode = '1v1' then
        is_best := zsm_private.final_winner(times ->> 0, times ->> 1) = player_index and counted @> jsonb_build_array(game_index);
        is_king := false; score := case when is_best then 1 else 0 end;
      else
        king_index := case when p_mode = 'solo' then player_index + 1
          when player_index < p_player_count / 2 then 1 + player_index * 2
          else 2 + (player_index - p_player_count / 2) * 2 end;
        is_king := game_index = king_index; is_best := value_ms is not null and value_ms = best;
        score := case when value_ms is null then 0
          when is_best then case when is_king then 12 else 11 end
          else greatest(0::numeric, 10 - floor((value_ms - best)::numeric / 1000))::integer end;
      end if;
      game_scores := game_scores || jsonb_build_array(jsonb_build_object('score', score, 'isBest', is_best, 'isKingMap', is_king));
    end loop;
    scores := scores || jsonb_build_array(game_scores);
  end loop;
  return jsonb_build_object('scores', scores, 'matchStatus', match_status);
end;
$$;

revoke all on function zsm_private.parse_time(text) from public, anon, authenticated;
revoke all on function zsm_private.is_final_time(text) from public, anon, authenticated;
revoke all on function zsm_private.final_winner(text, text) from public, anon, authenticated;
revoke all on function public.zsm_calculate(integer, jsonb, text, integer, integer) from public, anon, authenticated;
grant execute on function public.zsm_calculate(integer, jsonb, text, integer, integer) to authenticated;

commit;
