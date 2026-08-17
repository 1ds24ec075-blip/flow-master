// Copy Storage FILES from the old Supabase project to the new one.
//
// The DB dump only carried storage *metadata* (rows in storage.objects), not the
// actual file bytes. This script downloads every file from the old project's
// buckets and re-uploads them to the new project. Run it while the OLD project is
// still reachable — once Lovable tears it down, the files are gone.
//
// Usage (from the repo root, after `npm install`):
//
//   OLD_URL="https://OLDREF.supabase.co" \
//   OLD_SERVICE_KEY="<old service_role key>" \
//   NEW_URL="https://yjgozhjosautybusmxdl.supabase.co" \
//   NEW_SERVICE_KEY="<new service_role key>" \
//   node scripts/copy-storage.mjs
//
// Get each service_role key from: Dashboard -> Project Settings -> API ->
// "service_role" secret. Treat these like passwords; do not commit them.

import { createClient } from "@supabase/supabase-js";

const { OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY } = process.env;

for (const [name, val] of Object.entries({ OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY })) {
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
}

const BUCKETS = ["bills", "po-documents"];
const LIST_LIMIT = 1000;

const oldClient = createClient(OLD_URL, OLD_SERVICE_KEY, { auth: { persistSession: false } });
const newClient = createClient(NEW_URL, NEW_SERVICE_KEY, { auth: { persistSession: false } });

// Recursively list every file path in a bucket. In Supabase storage a "folder"
// comes back as an entry whose id is null, so we recurse into those.
async function listAllFiles(client, bucket, prefix = "") {
  const files = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: LIST_LIMIT, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // it's a folder — recurse
        const nested = await listAllFiles(client, bucket, path);
        files.push(...nested);
      } else {
        files.push(path);
      }
    }
    if (data.length < LIST_LIMIT) break;
    offset += LIST_LIMIT;
  }
  return files;
}

async function ensureBucket(bucket) {
  const { data } = await newClient.storage.getBucket(bucket);
  if (!data) {
    const { error } = await newClient.storage.createBucket(bucket, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`createBucket ${bucket}: ${error.message}`);
    }
    console.log(`  (created private bucket "${bucket}" on new project)`);
  }
}

let totalOk = 0;
let totalFail = 0;

for (const bucket of BUCKETS) {
  console.log(`\n=== bucket: ${bucket} ===`);
  await ensureBucket(bucket);

  let paths;
  try {
    paths = await listAllFiles(oldClient, bucket);
  } catch (e) {
    console.error(`  could not list old bucket: ${e.message}`);
    continue;
  }
  console.log(`  ${paths.length} file(s) to copy`);

  for (const path of paths) {
    const { data: blob, error: dErr } = await oldClient.storage.from(bucket).download(path);
    if (dErr || !blob) {
      console.error(`  FAIL download ${path}: ${dErr?.message || "no data"}`);
      totalFail++;
      continue;
    }
    const { error: uErr } = await newClient.storage
      .from(bucket)
      .upload(path, blob, { upsert: true, contentType: blob.type || "application/octet-stream" });
    if (uErr) {
      console.error(`  FAIL upload ${path}: ${uErr.message}`);
      totalFail++;
    } else {
      console.log(`  ok   ${path}`);
      totalOk++;
    }
  }
}

console.log(`\nDone. ${totalOk} copied, ${totalFail} failed.`);
process.exit(totalFail > 0 ? 1 : 0);
