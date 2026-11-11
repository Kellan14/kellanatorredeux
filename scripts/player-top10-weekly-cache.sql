-- A compact weekly snapshot of the existing four top-ten ranking categories.
-- A score occupies a slot (not a distinct player). Keep each player's best
-- rank in each category, and use a stable game/slot tiebreak for equal scores.
create materialized view public.cache_player_top10_weekly as
with latest as (
  select coalesce(max(season), 22) as season from public.matches
), limits as (
  select lower(machine) as machine, min(nullif(max_score, 0)) as max_score
  from public.score_limits group by lower(machine)
), scores as (
  select g.id, g.machine, g.season, latest.season as current_season,
    case lower(g.venue)
      when '4bs' then '4Bs'
      when '4bs tavern' then '4Bs'
      when 'four b''s' then '4Bs'
      when 'another castle' then 'Another Castle'
      when 'ice box' then 'Icebox'
      when 'icebox' then 'Icebox'
      when 'the kraken' then 'Kraken'
      when 'kraken' then 'Kraken'
      else nullif(g.venue, '')
    end as venue,
    p.slot, p.player_name, p.player_key, p.score
  from public.games g
  cross join latest
  left join limits l on l.machine = lower(g.machine)
  cross join lateral (values
    (1, g.player_1_name, g.player_1_key, g.player_1_score),
    (2, g.player_2_name, g.player_2_key, g.player_2_score),
    (3, g.player_3_name, g.player_3_key, g.player_3_score),
    (4, g.player_4_name, g.player_4_key, g.player_4_score)
  ) p(slot, player_name, player_key, score)
  where g.season between 2 and latest.season and nullif(g.machine, '') is not null
    and nullif(p.player_name, '') is not null and p.score is not null
    and (l.max_score is null or p.score <= l.max_score)
), ranked as (
  select s.player_name, s.player_key, s.machine, scope.venue, scope.priority, s.score,
    row_number() over (partition by s.machine, scope.venue, scope.priority
      order by s.score desc, s.id, s.slot) as rank
  from scores s
  cross join lateral (values
    (1, null::text, true),
    (2, s.venue, s.venue is not null),
    (3, null::text, s.season = s.current_season),
    (4, s.venue, s.venue is not null and s.season = s.current_season)
  ) scope(priority, venue, included)
  where scope.included
), best as (
  select distinct on (player_name, machine, venue, priority) *
  from ranked where rank <= 10
  order by player_name, machine, venue, priority, rank
)
select player_name, max(player_key) as player_key, now() as refreshed_at,
  jsonb_agg(jsonb_build_object('machine', machine, 'venue', venue,
    'priority', priority, 'rank', rank, 'score', score)
    order by priority, rank, score desc, machine, venue) as rankings
from best group by player_name;

create unique index cache_player_top10_weekly_player on public.cache_player_top10_weekly(player_name);
revoke all on public.cache_player_top10_weekly from public, anon, authenticated;
grant select on public.cache_player_top10_weekly to service_role;

create function public.refresh_player_top10_weekly() returns integer
language plpgsql security definer set search_path = '' as $$
declare refreshed_players integer;
begin
  refresh materialized view concurrently public.cache_player_top10_weekly;
  select count(*) into refreshed_players from public.cache_player_top10_weekly;
  if refreshed_players = 0 then
    raise exception 'Ranking refresh produced an empty snapshot';
  end if;
  return refreshed_players;
end;
$$;
revoke all on function public.refresh_player_top10_weekly() from public, anon, authenticated;
grant execute on function public.refresh_player_top10_weekly() to service_role;
