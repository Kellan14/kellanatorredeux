import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

// This deliberately only connects to the isolated local test cluster, never
// .env.local or production. All schema, fixtures and edits roll back afterward.
const client = new pg.Client({
  host: '127.0.0.1',
  port: 55439,
  user: 'canon_test',
  database: 'postgres',
})
await client.connect()
try {
  await client.query('BEGIN')
  await client.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE machine_canon(key text PRIMARY KEY,name text NOT NULL,display_override text,source text NOT NULL CHECK(source IN ('mnp','local')),mnp_key text,mnp_name text,note text,active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
    CREATE TABLE machine_aliases(alias text PRIMARY KEY,alias_raw text,canon_key text REFERENCES machine_canon(key),origin text,reason text);
    CREATE TABLE games(id bigserial PRIMARY KEY,machine text,machine_raw text);
    CREATE TABLE score_limits(machine text PRIMARY KEY,max_score bigint);
    CREATE TABLE user_machine_scores(id bigserial PRIMARY KEY,machine text,score bigint);
    CREATE TABLE user_machine_inputs(id bigserial PRIMARY KEY,player_name text,machine text,venue text,user_average bigint,UNIQUE(player_name,machine,venue));
    CREATE TABLE custom_backglass_images(id bigserial PRIMARY KEY,machine_key text,image_type text,public_url text,UNIQUE(machine_key,image_type));
    CREATE TABLE venue_machine_lists(venue_name text PRIMARY KEY,included jsonb,excluded jsonb);
    CREATE TABLE cache_team_pick_games(game_id bigint PRIMARY KEY,machine text);
    CREATE TABLE cache_team_machine_stats(machine text);
    CREATE TABLE cache_player_machine_stats(machine text);
    CREATE TABLE cache_machine_top_scores(machine text);
    CREATE TABLE machine_name_issues(raw_value text,issue_type text,suggested_key text);
    CREATE TABLE data_provenance(batch_id text,category text,entity text,description text,transformation_rule text,reason text,source text,rows_affected integer,details jsonb);
  `)
  await client.query(
    readFileSync(
      new URL('./machine-canon-management.sql', import.meta.url),
      'utf8',
    ),
  )
  const change = async (values) =>
    (
      await client.query('select manage_machine_canon($1::jsonb) as result', [
        JSON.stringify({
          reason: 'Reviewed source evidence',
          actor: 'test',
          ...values,
        }),
      ])
    ).rows[0].result
  async function rejects(values, pattern) {
    await client.query('SAVEPOINT expected_error')
    await assert.rejects(change(values), pattern)
    await client.query('ROLLBACK TO SAVEPOINT expected_error')
    await client.query('RELEASE SAVEPOINT expected_error')
  }
  await client.query(`
    INSERT INTO games(machine) VALUES ('New Game'),('newgame');
    INSERT INTO user_machine_scores(machine,score) VALUES ('New Game',123);
    INSERT INTO score_limits VALUES ('New Game',1000);
    INSERT INTO custom_backglass_images(machine_key,image_type,public_url) VALUES ('New Game','full','original-url');
    INSERT INTO venue_machine_lists VALUES ('Test Venue','["New Game","Other"]'::jsonb,'[]'::jsonb);
  `)
  const created = await change({
    key: 'TEMP',
    name: 'New Game',
    source: 'local',
    rawValues: ['New Game', 'newgame'],
  })
  assert.equal(created.source, 'local')
  assert.deepEqual(
    (await client.query('select machine,machine_raw from games order by id'))
      .rows,
    [
      { machine: 'TEMP', machine_raw: 'New Game' },
      { machine: 'TEMP', machine_raw: 'newgame' },
    ],
  )
  assert.equal(
    (await client.query('select machine from user_machine_scores')).rows[0]
      .machine,
    'TEMP',
  )
  assert.equal(
    (await client.query('select machine_key from custom_backglass_images'))
      .rows[0].machine_key,
    'TEMP',
  )
  assert.ok(
    (
      await client.query('select included from venue_machine_lists')
    ).rows[0].included.includes('TEMP'),
  )
  await rejects(
    {
      key: 'STEAL',
      name: 'Other New Game',
      source: 'local',
      rawValues: ['New Game'],
    },
    /already belongs/,
  )
  await client.query(
    `INSERT INTO cache_team_pick_games VALUES (1,'temp'); INSERT INTO cache_machine_top_scores VALUES ('temp'),('official');`,
  )
  await change({
    key: 'OFFICIAL',
    name: 'New Game',
    source: 'mnp',
    previousKey: 'TEMP',
    mnpKey: 'OFFICIAL',
    mnpName: 'New Game',
    rawValues: [],
  })
  assert.equal(
    (
      await client.query(
        "select count(*)::int n from machine_canon where key='TEMP'",
      )
    ).rows[0].n,
    0,
  )
  assert.equal(
    (
      await client.query(
        "select canon_key from machine_aliases where alias='temp'",
      )
    ).rows[0].canon_key,
    'OFFICIAL',
  )
  assert.equal(
    (await client.query('select machine from cache_team_pick_games')).rows[0]
      .machine,
    'official',
  )
  assert.equal(
    (await client.query('select count(*)::int n from cache_machine_top_scores'))
      .rows[0].n,
    0,
  )
  assert.equal(
    (await client.query('select machine_raw from games order by id')).rows[0]
      .machine_raw,
    'New Game',
  )
  await change({
    key: 'OFFICIAL',
    name: 'New Official Title',
    source: 'mnp',
    mnpKey: 'OFFICIAL',
    mnpName: 'New Official Title',
    rawValues: [],
  })
  assert.equal(
    (
      await client.query(
        "select canon_key from machine_aliases where alias='new game'",
      )
    ).rows[0].canon_key,
    'OFFICIAL',
    'Previous official titles stay resolvable',
  )
  await change({
    key: 'SAME',
    name: 'Temporary Title',
    source: 'local',
    rawValues: [],
  })
  await rejects(
    {
      key: 'SAME',
      name: 'Published Title',
      source: 'mnp',
      mnpKey: 'SAME',
      mnpName: 'Published Title',
      rawValues: [],
    },
    /Select the provisional record/,
  )
  await change({
    key: 'SAME',
    name: 'Published Title',
    source: 'mnp',
    previousKey: 'SAME',
    mnpKey: 'SAME',
    mnpName: 'Published Title',
    rawValues: [],
  })
  assert.equal(
    (await client.query("select source from machine_canon where key='SAME'"))
      .rows[0].source,
    'mnp',
  )
  await client.query(
    `INSERT INTO user_machine_inputs(player_name,machine,venue,user_average) VALUES ('Test','Collision Game','Venue',1),('Test','collisiongame','Venue',2); INSERT INTO games(machine) VALUES ('Collision Game');`,
  )
  await rejects(
    {
      key: 'COLLISION',
      name: 'Collision Game',
      source: 'local',
      rawValues: ['Collision Game', 'collisiongame'],
    },
    /Conflicting saved settings/,
  )
  assert.equal(
    (
      await client.query(
        "select count(*)::int n from machine_canon where key='COLLISION'",
      )
    ).rows[0].n,
    0,
    'A failed merge rolls back the canon row',
  )
  assert.equal(
    (
      await client.query(
        "select machine from games where machine='Collision Game'",
      )
    ).rowCount,
    1,
    'A failed merge rolls back source rewrites',
  )
  const logs = (await client.query('select * from data_provenance')).rows
  assert.equal(logs.length, 5, 'Only successful edits create audit entries')
  assert.equal(logs[1].details.previous.key, 'TEMP')
  assert.equal(logs[1].details.before.score_limits[0].machine, 'TEMP')
  assert.equal(
    (
      await client.query(
        "select has_function_privilege('anon','manage_machine_canon(jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  )
  console.log(
    'Transactional creation, aliases, MNP promotion, cache invalidation, provenance, conflict rollback and access restrictions passed',
  )
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
