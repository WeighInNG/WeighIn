   `host_features`, `resource_limits_sha256`, `source_account`, and schema-4/5
   per-metric `availability`, `source`, `limit`, `limit_source`, and
   `limit_reason`. Schema 5 additionally rejects any source/cap mapping not
   explicitly approved for that metric, even when BASE and HEAD use the same
   fabricated value.