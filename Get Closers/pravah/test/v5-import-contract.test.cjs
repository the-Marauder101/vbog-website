const fs=require('fs'); const path=require('path'); const root=path.resolve(__dirname,'..','..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=read('supabase/14_v5_transition_layer.sql'); const verify=read('supabase/15_verify_v5_transition_layer.sql');
for(const table of ['pravah_import_profiles','pravah_import_mapping_versions','pravah_import_batches','pravah_import_rows','pravah_import_replays']) if(!sql.includes(`create table if not exists ${table}`)) throw new Error(`Missing ${table}`);
for(const fn of ['pravah_import_create_profile','pravah_import_stage_rows','pravah_import_validate_batch','pravah_import_replay_batch']) if(!sql.includes(`function ${fn}(`)) throw new Error(`Missing ${fn}`);
for(const marker of ['source_record_key','raw_payload','validation_errors','needs_repair','duplicate','force row level security','revoke all on function']) if(!sql.includes(marker)) throw new Error(`Missing safety contract: ${marker}`);
if(sql.includes('service_role')) throw new Error('Service-role credential forbidden.');
if(!verify.includes('anon_can_execute')||!verify.includes('forced_rls')) throw new Error('Verification contract incomplete.');
console.log('V5 import contract checks passed.');
