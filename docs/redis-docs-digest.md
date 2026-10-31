# Redis docs digest (fetched 2026-11-01 from redis.io/docs/latest)

IMPORTANT FRAMING NOTES FOR THE DESIGNER
- The "latest" docs fetched today are AHEAD of what most people have installed. They document features labelled Redis 8.2, 8.4, 8.6, 8.8 and even 8.10 (e.g. new "Arrays" data type "since 8.8.0", INCREX 8.8.0, XNACK 8.8.0, LMOVEM 8.10.0, HIMPORT/compact hashes 8.10.0, TS.NRANGE 8.10.0, SDIFFCARD/SUNIONCARD 8.10.0). Whether a Docker `redis:latest` image today actually contains these is NOT stated on these pages. Version labels below are quoted from the docs; verify against the actual image tag before putting any 8.4+/8.6+/8.8+/8.10 command into course exercises.
- Source method: pages were fetched as raw markdown (`<url>/index.html.md`) and WebFetch. Only facts from those pages are recorded. Where a page did not say something, it is marked "not stated".
- Bike inventory (`bike:1`, `bikes:racing:france`, ...) is the docs' own sample domain.

---

## https://redis.io/docs/latest/develop/get-started/
- Title "Quick starts". Says Redis "can be used as a database, cache, streaming engine, message broker, and more".
- Lists only two quick starts: (1) Data structure store `/develop/get-started/data-store`; (2) Redis Search tutorial `/develop/get-started/search-tutorial` (data modeling hashes vs JSON, indexing, FT.SEARCH, FT.AGGREGATE, and vector/hybrid search).
- Also links FAQ `/develop/get-started/faq` (exists, 200).
- There is no separate "document database" or "vector database" page any more; old names redirect into the Search tutorial (the data-store page "Next steps" labels "Redis as a document database" -> search-tutorial, "Redis as a vector database" -> search-tutorial/vector-search; skip vector).

## https://redis.io/docs/latest/develop/get-started/data-store
- Quick start "Redis as an in-memory data structure store". Sample domain: bicycle inventory. Four goals: get started, store data under a key, retrieve by key, scan keyspace by pattern.
- Setup: easiest = Redis Cloud free account; or local install via the install guides.
- Connect: `redis-cli -h 127.0.0.1 -p 6379` (default port 6379). Node example uses `createClient()` from 'redis', `client.on('error', ...)`, `await client.connect()`, and at end `await client.close()`. Python: `redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)`.
- Strings: `SET bike:1 "Process 134"`, `GET bike:1`. Doc says "Redis stands for Remote Dictionary Server"; strings store "text, serialized objects, counter values, and binary arrays".
- Hashes: `HSET bike:2 model Deimos brand Ergonom type 'Enduro bikes' price 4972` returns (integer) 4 (fields added); `HGET bike:2 model`; `HGETALL bike:2`. Complexity: HSET O(1), HGET O(1), HGETALL O(N). Node: `client.hSet('bike:1', {...})`, `hGet`, `hGetAll` (values come back as strings, e.g. price '4972').
- Keyspace scan: `SCAN 0 MATCH "bike:*" COUNT 100` "returns a cursor position, allowing you to scan iteratively ... until you reach the cursor value 0".
- Auth: Cloud connection string format `host:port`; pass username/password to client or use AUTH command.

## https://redis.io/docs/latest/develop/get-started/search-tutorial (and its subpages)
- A guided tour of Redis Search for people new to Redis. Dataset: online-store product catalog (fields: name, brand, category, description, price, rating, review_count, stock, release_year, features[]).
- Steps (each a subpage): data-modeling, indexing, search, aggregation, vector-search (last one is vector/hybrid: SKIP). Subpage URLs: /develop/get-started/search-tutorial/data-modeling, /indexing, /search, /aggregation, /vector-search.
- Prerequisite: "a running Redis instance that includes Redis Search and the JSON data type". Options: Redis Cloud free DB ("comes with all the Redis Open Source features, including Redis Search and JSON") or local Redis Open Source install.
- NOTE: "The vector and hybrid search examples ... require Redis 8.8 or later. The earlier steps work on any recent version of Redis with Redis Search."
- Tooling options named: redis-cli, Redis Insight (Search workspace to browse indexes and run queries), or a client library (Python, Node tabs).
- Connect: `redis-cli -h 127.0.0.1 -p 6379`.
(See the search-and-query section below for the technical detail from the subpages.)

## https://redis.io/docs/latest/develop/get-started/faq
- Redis vs other KV stores: values hold complex data types with atomic operations; "in-memory but persistent on disk"; RDB and AOF "don't need to be suitable for random access ... always generated in an append-only fashion".
- Memory footprint examples (64-bit): empty instance ~3 MB; 1 million small String keys ~85 MB; 1 million Hash keys with 5 fields ~160 MB. "Use the `redis-benchmark` utility ... then check the space used with the `INFO memory` command." 64-bit uses more memory than 32-bit because pointers are 8 bytes.
- Why in memory: "no plans to create an on disk backend"; datasets bigger than RAM -> partitioning/sharding (links to scaling page). "Redis on Flash" is a Redis Ltd. product "not part of the Redis Open Source code base".
- Disk DB pattern: keep write-heavy small data in Redis, big blobs in SQL/other DB; or hold a copy of a subset updated together with the disk DB (not just refreshed on cache misses).
- Out of memory: set `maxmemory`; when reached Redis "will start to reply with an error to write commands (but will continue to accept read-only commands)"; or configure eviction (see eviction page).
- fork() failure on background save (Linux): fix `echo 1 > /proc/sys/vm/overcommit_memory`; explanation: copy-on-write, with overcommit_memory=0 the fork fails unless free RAM >= dataset size (example: 3 GB dataset, 2 GB free fails).
- Snapshots are atomic: the background save forks "when the server is outside of the execution of a command".
- Multiple cores: CPU rarely the bottleneck, usually memory or network bound. "when using pipelining a Redis instance running on an average Linux system can deliver 1 million requests per second". Run multiple instances and shard to use more cores. "As of version 4.0 ... threaded actions ... limited to deleting objects in the background and blocking commands implemented via Redis modules."
- Limits: up to 2^32 keys (tested at least 250 million keys per instance); each hash/list/set/sorted set can hold 2^32 elements; "your limit is likely the available memory".
- Replica key count may differ from primary when keys have TTLs (expired-but-not-yet-reclaimed keys are counted by INFO/DBSIZE on primary but not loaded in replica from the RDB).
- Name: REmote DIctionary Server. Created by Salvatore Sanfilippo to scale LLOOGG (real-time log analysis).

---

## https://redis.io/docs/latest/develop/data-types/
- "Redis is a data structure server." Open Source implements: Strings (with Bitmaps and Bitfields as string-based), **Arrays (new)**, Geospatial indexes, Hashes, JSON, Lists, Probabilistic (Bloom, Count-min sketch, Cuckoo, HyperLogLog, t-digest, Top-K), Sets, Sorted sets, Streams, Time series, Vector sets (skip).
- Intro examples: strings for caching, lists for queuing, streams for event processing.
- "Compare data types" guide at /develop/data-types/compare-data-types (summarised below).
- Extensions: custom server-side Lua functions (/develop/programmability) or modules API (/develop/reference/modules).
- Notes: HyperLogLog URL is `/develop/data-types/probabilistic/hyperloglogs` (plural); time series URL is `/develop/data-types/timeseries`; bitmaps/bitfields live under `/develop/data-types/strings/bitmaps` and `/strings/bitfields`.

## https://redis.io/docs/latest/develop/data-types/compare-data-types
- Specialised: geospatial, probabilistic, time series, vector sets. General purpose: strings, arrays, hashes, JSON, lists, sets, sorted sets, streams. Advice is "rules-of-thumb". Any can be emulated with strings, but trade-offs differ in performance, memory, functionality.
- Strings: unstructured text/binary, counters, bit sets. Hashes: "simple objects with a small number of fields"; field values are strings but can be treated as ints/floats; per-field expiration; indexable with Redis Search. JSON: complex nested objects; richer Redis Search features than hashes. Lists: queues, stacks, deques; efficient at head/tail. Sets: unique items; membership, intersect, union, difference. Sorted sets: unique items with score; range by score/rank; priority queues. Streams: append-only log; consumer groups "ensure at-least-once delivery". Arrays: sparse integer-indexed, ring buffers, sensor readings.
- Documents: "JSON generally has the highest requirements for memory and processing, followed by hashes, and then strings."
  Decision tree: nested data or geospatial in Search -> JSON; need Search but no nesting -> hashes (lower memory, faster field access than JSON); need per-field expiration -> hashes; only integer/bit fields -> strings; frequent field access with string/binary values -> hashes; otherwise strings.
- Collections: "Sorted sets have the highest memory overhead and processing requirements, followed by sets, and then strings." Tree: need ordering -> sorted set; need extra info per key and no set ops -> hash; keys are integer indices in known range -> string bitmap (bitwise ops equal set ops); else set. Extra info for set members can live in an auxiliary hash/JSON.
- Sequences: need priority/lexicographic order or set ops -> sorted set; caller-chosen integer index, sparse, server-side aggregation, ring buffer -> arrays; timestamp ordering or multiple consumers -> streams; else lists.

## https://redis.io/docs/latest/develop/data-types/strings/
- Byte sequences: text, serialized objects, binary arrays. Used for caching HTML fragments/pages; also counters and bit ops.
- Core commands (complexity): SET (O(1); options NX, XX, and new IFEQ condition), GET, GETSET/GETDEL/GETEX (6.2.0), MSET/MGET (O(N) keys, atomic), SETNX, SETEX/PSETEX, MSETNX, INCR/INCRBY/DECR/DECRBY/INCRBYFLOAT (O(1), key treated as 0 if missing, atomic), APPEND, STRLEN, GETRANGE/SETRANGE/SUBSTR, LCS (7.0.0, O(N*M)).
- Newer per docs: DELEX and DIGEST (8.4.0) - e.g. `SET bike:1 Ares IFEQ Deimos` and `DELEX bike:1 IFEQ Ares` (compare-and-set / compare-and-delete, useful for safe lock release); MSETEX (8.4.0, shared expiry); INCREX (8.8.0, increment + set expiry).
- Counter example: `SET total_crashes 0`, `INCR total_crashes`, `INCRBY total_crashes 10`.
- Limit: "By default, a single Redis string can be a maximum of 512 MB."
- Performance warning: most O(1), "be careful with SUBSTR, GETRANGE, and SETRANGE, which can be O(n)" on large strings.
- Alternatives: for serialized structured data consider hashes or JSON.

## https://redis.io/docs/latest/develop/data-types/strings/bitmaps
- Not a real type: bit-oriented ops on strings; max 512 MB so up to 2^32 bits.
- Commands: SETBIT, GETBIT (O(1), out-of-range bits read as 0, SETBIT auto-grows string), BITCOUNT (population count, optional byte/bit range), BITPOS (first 0/1 bit), BITOP (AND, OR, XOR, NOT, DIFF, DIFF1, ANDOR, ONE; O(n) on longest string), BITFIELD, BITFIELD_RO.
- Use cases: dense sets over integers 0..N; object permission flags; example: 1000 sensors, key per hour, SETBIT sensor-id 1, GETBIT to check ping. Claim: 1 bit for 4 billion users in 512 MB.
- Pattern: split bitmap across keys: M bits per key, key = bit-number/M, bit inside key = bit-number MOD M (good for sharding, avoid huge keys).

## https://redis.io/docs/latest/develop/data-types/strings/bitfields
- Atomic get/set/incr of arbitrary-width integers inside a string: "unsigned 1-bit integers to signed 63-bit integers".
- Syntax from example: `BITFIELD bike:1:stats SET u32 #0 1000`; `BITFIELD bike:1:stats INCRBY u32 #0 -50 INCRBY u32 #1 1`; `BITFIELD bike:1:stats GET u32 #0 GET u32 #1`. `#0`, `#1` index counters by width.
- Complexity: O(1) per subcommand ("O(n), n = number of counters accessed"). Overflow policies are not described on this page (the "overflow policies" appear only in the data-types index description: "different overflow policies").
- Node: `client.bitField(key, [{operation:'INCRBY', encoding:'u32', offset:'#0', increment:-50}, ...])`.

## https://redis.io/docs/latest/develop/data-types/lists/
- Linked lists of strings. Push/pop at head/tail O(1) "even if you have millions of elements"; index/middle access O(N) (LINDEX, LINSERT, LSET). Max length 2^32 - 1 elements.
- Commands: LPUSH/RPUSH (variadic; X variants only if exists), LPOP/RPOP (optional count), LRANGE (O(S+N); negative indexes, `0 -1` = all), LLEN O(1), LTRIM (keep range; used for capped lists), LINDEX, LINSERT, LSET, LREM, LPOS (6.0.6), LMOVE (6.2.0, atomic pop-push between lists, e.g. `LMOVE bikes:repairs bikes:finished LEFT LEFT`), BLPOP/BRPOP (timeout in seconds, e.g. `BRPOP bikes:repairs 1`), BLMOVE, LMPOP/BLMPOP (7.0.0), BRPOPLPUSH/RPOPLPUSH (superseded by LMOVE/BLMOVE), new LMOVEM/BLMOVEM (8.10.0, move many).
- Use cases (doc): stacks and queues; background worker queues (Resque, Sidekiq use Redis lists); "latest N" feeds (LPUSH + `LRANGE 0 9`; Twitter timeline mentioned); capped lists via `LTRIM key 0 N-1` after push.
- Queue pattern shown: producer `LPUSH`, consumer `RPOP`; FIFO. Doc says polling with RPOP is bad (useless commands + added delay); use blocking BRPOP/BLPOP.
- Reliable queue: `LMOVE` into a processing list so a crashed consumer doesn't lose the item (atomic).
- Auto create/delete rule: pushing creates key; removing last element deletes key (all aggregate types EXCEPT Streams); wrong type -> `WRONGTYPE` error; read on missing key behaves as empty.
- Alternative: Streams when you need to "store and process an indeterminate series of events".

## https://redis.io/docs/latest/develop/data-types/sets/
- Unordered unique strings; add/remove/test O(1). Max 2^32 - 1 members.
- Commands: SADD, SREM, SISMEMBER, SMISMEMBER (6.2.0), SMEMBERS (O(N)), SCARD, SINTER/SUNION/SDIFF (+ STORE variants; SINTERCARD 7.0.0; SDIFFCARD, SUNIONCARD 8.10.0), SPOP, SRANDMEMBER, SMOVE, SSCAN.
- Use cases (doc): track unique items (unique IPs per blog post); relations (users with a role); intersection/union/difference.
- Pitfall: `SMEMBERS` on sets with hundreds of thousands of members is O(N) and returns everything in one reply; use `SSCAN`.
- Alternatives: Bloom/Cuckoo filters if memory matters and perfect precision is not needed ("40 bytes (320 bits) per item" for IPs in a set vs ~19 bits in a Bloom filter at 0.01%); JSON + Redis Search if you need indexing/querying.

## https://redis.io/docs/latest/develop/data-types/hashes/
- Field-value records under one key; "objects" and groups of counters. Limit 2^32 - 1 field-value pairs (practically memory-bound).
- Commands: HSET (variadic, returns count of NEW fields), HGET, HMGET, HGETALL (O(N)), HDEL, HEXISTS, HKEYS/HVALS (O(N)), HLEN, HINCRBY, HINCRBYFLOAT, HRANDFIELD, HSCAN, HSETNX, HSTRLEN, HMSET (old).
- Counter pattern: `HINCRBY bike:1:stats rides 1`, then `HMGET`.
- Field expiration (new in 7.4): HEXPIRE, HPEXPIRE, HEXPIREAT, HPEXPIREAT, HTTL, HPTTL, HEXPIRETIME, HPEXPIRETIME, HPERSIST. Example: `HEXPIRE sensor:sensor1 60 FIELDS 2 air_quality battery_level`, `HTTL sensor:sensor1 FIELDS 2 air_quality battery_level`. Redis 8.0 adds HGETEX, HSETEX, HGETDEL.
- Doc-listed field-expiry use cases: event tracking (TTL 1h, `HLEN` counts last hour), fraud detection (hourly counters with 48h TTL), customer session management, active-session tracking (TTL = inactivity timeout, `HLEN` = active sessions).
- Compact hashes (8.10): shared field-name sets; HIMPORT PREPARE/SET; config defaults 0 (off), e.g. `hash-max-template-entries` (named in text); hashes using field expiration are NOT converted. Pitfalls stated: dynamic field names erode savings; very large hashes sent as one blob in replication; once compact always compact.
- Performance: most O(1); HKEYS, HVALS, HGETALL, most expiry commands O(N).

## https://redis.io/docs/latest/develop/data-types/sorted-sets/
- Unique members ordered by float score; ties broken lexicographically (memcmp, no collation). "a mix between a Set and a Hash". Ordered by data structure, not sorted on request.
- Commands (35 in group): ZADD (O(log N) per item; options not shown on this page), ZINCRBY, ZRANGE (unified: BYSCORE, BYLEX, REV, LIMIT, WITHSCORES; O(log(N)+M)), ZRANGESTORE, ZRANK/ZREVRANK, ZSCORE, ZMSCORE, ZCARD, ZCOUNT, ZREM, ZREMRANGEBYSCORE/RANK/LEX, ZPOPMIN/ZPOPMAX, BZPOPMIN/BZPOPMAX, ZMPOP/BZMPOP (7.0.0), ZUNION/ZINTER/ZDIFF (+STORE; 6.2.0), ZLEXCOUNT, ZRANDMEMBER, ZSCAN. Old ZRANGEBYSCORE/ZREVRANGE etc. still listed.
- Examples: `ZADD racer_scores 10 "Norem"`; `ZRANGE racer_scores 0 -1 REV WITHSCORES`; `ZRANGE racer_scores -inf 10 BYSCORE`; `ZRANGE racer_scores [A [L BYLEX` (all scores equal -> lexicographic index, since 2.8); `ZINCRBY racer_scores 50 "Wood"`; `ZREMRANGEBYSCORE racer_scores -inf 9`.
- Use cases (doc): leaderboards; sliding-window rate limiters.
- Performance: "Most sorted set operations are O(log(n))"; caution with ZRANGE returning tens of thousands of results.
- Alternatives: for indexing other structures, consider JSON + Redis Search.

## https://redis.io/docs/latest/develop/data-types/streams/
- Append-only log with O(1) random access by ID and consumer groups. Use cases: event sourcing, sensor monitoring, per-user notifications.
- IDs `<ms>-<seq>`; `*` auto-generates; explicit IDs must be greater than top (else error); Redis 7+ allows `0-*` partial. Clock going backwards reuses previous ms.
- XADD key [MAXLEN|MINID [~|=] n] * field value ... ; e.g. `XADD race:france * rider Castilla speed 30.2 position 1 location_id 1`. O(1) add; O(N) when trimming.
- XRANGE/XREVRANGE `- +` inclusive; `(id` exclusive start (pagination: `XRANGE race:france (1692632094485-0 + COUNT 2`). XLEN O(1).
- XREAD `COUNT 100 BLOCK 300 STREAMS race:france $` (`$` = only new entries). Fan-out: every waiting client gets every entry (unlike BLPOP); entries persist (unlike Pub/Sub).
- Consumer groups: XGROUP (`XGROUP CREATE race:italy italy_riders $ MKSTREAM`), XREADGROUP (`XREADGROUP GROUP italy_riders Alice COUNT 1 STREAMS race:italy >`; `>` = never delivered; id `0` re-reads that consumer's own pending history), XACK (`XACK race:italy italy_riders <id>`), XPENDING (summary or extended), XCLAIM, XAUTOCLAIM (6.2; `XAUTOCLAIM race:italy italy_riders Alice 60000 0-0 COUNT 1` = claim entries idle >60000 ms), XPENDING also `XPENDING key group - + 10` for detail, XINFO STREAM/GROUPS/CONSUMERS, XTRIM, XDEL, XSETID. Guarantees: each message to one consumer in group; consumer names are case-sensitive, client chooses unique id; group tracks "first ID never consumed"; explicit ack required; PEL (pending entries list) per group.
- Delivery counter in XPENDING increments on XCLAIM or XREADGROUP history reads; use it to detect poison messages (dead letter pattern).
- New: Redis 8.2 XACKDEL, XDELEX and XADD/XTRIM options `KEEPREF` (default), `DELREF`, `ACKED`; 8.6 idempotent production (XCFGSET, XIDMPRECORD; "at-most-once production"); 8.8 XNACK with modes SILENT, FAIL, FATAL (release pending messages back to group; "NACK zone" at head of PEL).
- Kafka comparison: Redis groups are server-side load balancing on ONE key; "Kafka partitions are more similar to using N different Redis keys". To scale, shard across multiple stream keys (Cluster). 1 stream->1 consumer = ordered; 1 stream->N consumers may process out of order.
- Capped streams: `XADD ... MAXLEN` or `XTRIM`; example `XADD race:italy MAXLEN 2 * rider Jones`; the `~` approximate-trim form is not shown on this page.
- Special IDs: `-`, `+`, `$`, `>`, `*`.
- Durability/warnings: streams + group state go to AOF/RDB/replicas but "AOF must be used with a strong fsync policy if persistence of messages is important"; async replication means after failover "something can be missing"; `WAIT` can force propagation but failover is only best effort.
- Zero-length streams: unlike other types, key is NOT deleted when empty (consumer group state would be lost).
- Latency claim from docs' own test (vendor-published, old, slow hardware): 99.9% of requests <= 2 ms.
- Performance: XADD O(1); single entry access O(n) in ID length ~ constant; radix tree implementation.

## https://redis.io/docs/latest/develop/data-types/arrays/
- NEW type, all 18 commands "since 8.8.0": ARSET, ARGET, ARMSET, ARMGET, ARGETRANGE, ARSCAN, ARINSERT, ARNEXT, ARSEEK, ARRING, AROP, ARGREP, ARDEL, ARDELRANGE, ARLEN, ARCOUNT, ARINFO, ARLASTITEMS.
- Sparse index-addressable sequence: integer index 0..2^64-1 to string; setting index 1,000,000 does not allocate the gap. ARLEN = highest set index + 1; ARCOUNT = non-empty slots.
- ARINSERT uses internal cursor (ARNEXT, ARSEEK); ARRING = fixed-size circular buffer (`insert_idx % size`); AROP = single-pass aggregate (SUM, MAX, MATCH count...) over a range; ARGREP predicates EXACT, MATCH, GLOB, RE combined AND/OR.
- Config: `array-slice-size`, `array-sparse-kmax`, `array-sparse-kmin`.
- Limits: ARGETRANGE max 1,000,000 elements per call; "Arrays aren't supported in Active-Active databases". Most commands O(1); range ones O(N).
- Alternatives: lists for push/pop at ends or insert between; hashes for field-name addressing; streams for event log with consumer groups.
- Course implication: only usable on an 8.8+ server; not in older images.

## https://redis.io/docs/latest/develop/data-types/geospatial/
- Stores coordinates as members of a sorted-set-like index; for nearby points in radius or bounding box.
- Commands: GEOADD (O(log N) per item; `GEOADD bikes:rentable -122.27652 37.805186 station:1` = longitude then latitude), GEOSEARCH (6.2.0; O(N+log(M)); `GEOSEARCH bikes:rentable FROMLONLAT -122.2612767 37.7936847 BYRADIUS 5 km WITHDIST`; also box shape), GEOSEARCHSTORE, GEODIST, GEOPOS, GEOHASH. GEORADIUS, GEORADIUSBYMEMBER (+ _RO) still listed (3.2.0/3.2.10) but GEOSEARCH is the current form.
- Note: don't confuse with Redis Search geospatial features (more formats/queries).
- Lat/long valid ranges and storage-as-sorted-set are not stated on this page.

## https://redis.io/docs/latest/develop/data-types/json/
- Commands (25): JSON.SET, JSON.GET (with INDENT/NEWLINE/SPACE; JSONPath), JSON.MGET, JSON.MSET (2.6.0), JSON.MERGE (2.6.0), JSON.DEL/FORGET, JSON.TYPE, JSON.STRLEN, JSON.STRAPPEND, JSON.NUMINCRBY, JSON.NUMMULTBY, JSON.ARRAPPEND/ARRINSERT/ARRINDEX/ARRLEN/ARRPOP/ARRTRIM, JSON.OBJKEYS/OBJLEN, JSON.CLEAR (2.0.0), JSON.DEBUG (full 25-command list was truncated in my read; others not verified).
- Examples: `JSON.SET bike:1 $ '{"model":"Deimos","brand":"Ergonom","price":4972}'`; `JSON.GET newbike $[1].crashes`; `JSON.NUMINCRBY crashes $ 1.5`; `JSON.ARRAPPEND riders $ '"Norem"'`.
- Features: full JSON standard, JSONPath, binary tree storage for fast sub-element access, typed atomic ops. Works with Redis Search to index/query JSON.
- Limit: nesting depth up to 128 (deeper -> error). Part of Redis Open Source (also Software/Cloud).

## https://redis.io/docs/latest/develop/data-types/probabilistic/ (index) and HyperLogLog
- HyperLogLog (`/probabilistic/hyperloglogs`): estimates cardinality; "up to 12 KB of memory", "standard error rate of 0.81%"; encoded as a Redis string; up to 2^64 members. Commands PFADD, PFCOUNT, PFMERGE (PFDEBUG, PFSELFTEST internal). PFADD/PFCOUNT constant time; merge O(n) sketches. Example: `PFADD bikes Hyperion Deimos Phoebe Quaoar`, `PFCOUNT bikes`, `PFMERGE all_bikes bikes commuter_bikes`. Use: anonymous unique visits per page/song/video per period. Note in doc: storing IPs/identifiers is "against the law in some countries" so HLL avoids it.

## https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter
- Commands: BF.RESERVE key error_rate capacity [EXPANSION n | NONSCALING], BF.ADD, BF.MADD, BF.EXISTS, BF.MEXISTS, BF.INSERT, BF.CARD (2.4.4), BF.INFO, BF.SCANDUMP/LOADCHUNK. Example `BF.RESERVE bikes:models 0.001 1000000`.
- Semantics: "can guarantee the absence ... but can only give an estimation about its presence" (no false negatives; false positives at the set rate). Cannot delete.
- Sizing facts: 1% error = 7 hash functions, 9.585 bits/item; 0.1% = 10 hashes, 14.378 bits/item; 0.01% = 14 hashes, 19.170 bits/item. Optimal bits = capacity * -ln(error)/ln(2)^2.
- Scaling: adding never fails; error grows past capacity; auto-adds sub-filters sized x EXPANSION (use >=2 if size unknown; 1 if known); `NONSCALING` saves one hash function. Oversize wastes memory; undersize raises error/adds sub-filters.
- Use cases (doc): fraud ("has this user paid from this location before"), ad dedupe ("has user seen this ad"), username-taken check (on "yes" check main DB).
- Bloom vs Cuckoo: Bloom better at inserts/scale; Cuckoo faster at checks and supports delete. Insert O(K hashes); check O(K*n) stacked.

## https://redis.io/docs/latest/develop/data-types/probabilistic/cuckoo-filter
- Commands: CF.RESERVE key capacity [BUCKETSIZE][MAXITERATIONS][EXPANSION], CF.ADD, CF.ADDNX, CF.INSERT/INSERTNX, CF.EXISTS, CF.MEXISTS, CF.COUNT, CF.DEL, CF.INFO, CF.SCANDUMP/LOADCHUNK. Example `CF.RESERVE bikes:models 1000`, `CF.ADD`, `CF.EXISTS`, `CF.DEL`.
- Supports deletion. Pitfall: "inserting repeated items ... will try to add them multiple times causing your filter to fill up". Capacity rounded up to power of two; filter may declare full before capacity; fingerprint 8 bits. Bucket size 1 gives minimal false-positive rate ~0.78% (2/256), larger buckets raise error, improve fill. Config names: `cf-max-iterations`, `cf-max-expansions`.
- Use cases: targeted ad campaigns (remove user on signup), coupon validation (remove on use). Ops O(1).

## https://redis.io/docs/latest/develop/data-types/probabilistic/count-min-sketch
- Commands: CMS.INITBYDIM, CMS.INITBYPROB key error probability, CMS.INCRBY, CMS.QUERY, CMS.MERGE, CMS.INFO. Example `CMS.INITBYPROB bikes:profit 0.001 0.002`, `CMS.INCRBY bikes:profit "Smokey Mountain Striker" 100`.
- Estimates frequency in a stream; only over-counts (collisions); results below an error-derived threshold "should be ignored". Threshold grows with total count. O(1) ops. Use: per-day product sales volume.

## https://redis.io/docs/latest/develop/data-types/probabilistic/top-k
- Commands: TOPK.RESERVE key k [width depth decay] (defaults 7, 8, 0.9), TOPK.ADD (returns items demoted out), TOPK.INCRBY, TOPK.QUERY, TOPK.COUNT, TOPK.LIST, TOPK.INFO. HeavyKeeper algorithm (count-with-exponential-decay).
- Use: trending hashtags, DDoS detection (sudden flux to same address). TOPK.LIST is O(K*log K), so no separate sorted set needed if K small. Insertion O(K + depth).

## https://redis.io/docs/latest/develop/data-types/probabilistic/t-digest
- Commands (14): TDIGEST.CREATE key [COMPRESSION 100], TDIGEST.ADD, TDIGEST.MERGE destKey numKeys src... [COMPRESSION][OVERRIDE], TDIGEST.QUANTILE, TDIGEST.CDF, TDIGEST.RANK/REVRANK/BYRANK/BYREVRANK, TDIGEST.TRIMMED_MEAN, TDIGEST.MIN/MAX, TDIGEST.RESET, TDIGEST.INFO.
- Estimates percentiles without storing all points. COMPRESSION default 100 (accuracy vs memory). Use cases: latency percentiles (p50/p90/p99), gaming percentile rank, network DoS detection, predictive maintenance. CDF returns fraction smaller + half of equal.

## https://redis.io/docs/latest/develop/data-types/timeseries/
- Commands (21): TS.CREATE, TS.ADD (auto-creates; `*` = server time), TS.MADD (does NOT auto-create), TS.GET, TS.RANGE/REVRANGE, TS.MGET/MRANGE/MREVRANGE (filter by labels), TS.INCRBY/DECRBY, TS.DEL (1.6.0; inclusive range), TS.CREATERULE/DELETERULE (compaction), TS.ALTER, TS.INFO, new TS.NRANGE (8.10.0) (full 21-command list not fully verified).
- Options in examples: `TS.ADD thermometer:2 1 10.8 RETENTION 100`; `LABELS location UK type Mercury`; `FILTER_BY_TS`, `FILTER_BY_VALUE`; `AGGREGATION avg 2` (bucket ms); `ALIGN start`; `MRANGE - + FILTER country=(us,uk) GROUPBY country REDUCE max`; `TS.CREATERULE hyg:1 hyg:compacted AGGREGATION min 3` (destination must pre-exist; only new data processed).
- Aggregators: avg, sum, min, max, range, count, countNaN, countAll (both 8.6), first, last, std.p, std.s, var.p, var.s, twa.
- Redis 8.6: NaN values supported. RETENTION caps growth. Uses: IoT, metrics, finance, smart metering, QoS. Integrations: Prometheus adapter, Grafana (Redis Data Source), Telegraf, StatsD/Graphite.

---

## https://redis.io/docs/latest/develop/ai/search-and-query/ (non-vector parts) plus Search tutorial subpages
- Redis Search features: rich query language, incremental indexing on JSON and hash documents, full-text search, geospatial queries, aggregations (plus vector search: skip). Lets Redis act as document database, secondary index, search engine.
- Availability: "Redis Search is available in Redis Open Source, Redis Software, and Redis Cloud." Licence: "Source Available License 2.0 (RSALv2), the Server Side Public License v1 (SSPLv1), or the GNU Affero General Public License version 3 (AGPLv3)".
- Tutorial step 1 data modeling (/search-tutorial/data-modeling): hash `HSET hproduct:1 name "..." brand "Aurora" category "Audio" price 199.99 rating 4.6` vs JSON `JSON.SET product:1 $ '{...}'`. Table: choose hashes for flat records, smallest memory, frequent single-field updates; choose JSON for nested objects/arrays, shape matching app objects, nested path read/update/index. "Both can be indexed and searched." Dataset of 12 products under prefix `product:`. `JSON.GET product:1 $.name` returns `"[\"Aurora AcousticPro Headphones\"]"` (JSONPath returns array).
- Step 2 indexing (/indexing): index = "secondary index"; you give Redis (1) key prefix, (2) data type `ON HASH` | `ON JSON`, (3) schema (field path, type). Index auto-maintained; existing docs under prefix are indexed on creation and new/changed ones immediately.
  Field types: TEXT (word/full-text), TAG (exact labels), NUMERIC (range/sort), VECTOR (skip). (Patterns page also lists GEO, GEOSHAPE.)
  Command: `FT.CREATE idx:catalog ON JSON PREFIX 1 product: SCHEMA $.name AS name TEXT $.brand AS brand TAG SORTABLE $.category AS category TAG $.description AS description TEXT $.price AS price NUMERIC SORTABLE $.rating AS rating NUMERIC SORTABLE $.review_count AS review_count NUMERIC $.stock AS stock NUMERIC $.release_year AS release_year NUMERIC $.features[*] AS features TAG` (truncated in doc; array tag line quoted exactly: `$.features[*] AS features TAG`).
  Pitfall (doc): index JSON arrays with `[*]` ("the single most common point of confusion"). In a HASH a TAG field splits on commas by default; in JSON there is no automatic splitting (use `[*]` or SEPARATOR).
  `FT.INFO idx:catalog` shows index details and doc count.
- Step 3 search (/search): shape `FT.SEARCH <index> "<query>" [RETURN n field...] [SORTBY f ASC|DESC] [LIMIT offset count]`. Default returns first 10 matches. Examples:
  `FT.SEARCH idx:catalog "*" LIMIT 0 0` (count only: first reply element is total)
  `FT.SEARCH idx:catalog "@name:headphones" RETURN 1 name` (text, `@field:term`)
  `FT.SEARCH idx:catalog "@description:\"noise cancelling\"" RETURN 1 name` (exact phrase, escaped quotes)
  `FT.SEARCH idx:catalog "@category:{Audio}" RETURN 2 name price` (tag, curly braces)
  `FT.SEARCH idx:catalog "@features:{waterproof}" RETURN 1 name`
  `FT.SEARCH idx:catalog "@price:[0 100]" SORTBY price ASC RETURN 2 name price` (numeric range)
  `FT.SEARCH idx:catalog "@category:{Audio} @price:[0 100]"` (juxtaposition = AND)
  `FT.SEARCH idx:catalog "*" SORTBY price DESC RETURN 2 name price LIMIT 0 3`
  "Without RETURN, the full document comes back for every match." Returned JSON-index field values are the raw values.
- Step 4 aggregation (/aggregation): FT.AGGREGATE runs a pipeline: GROUPBY, REDUCE, APPLY, SORTBY, LOAD. Examples:
  `FT.AGGREGATE idx:catalog "*" GROUPBY 1 @category REDUCE COUNT 0 AS count`
  `FT.AGGREGATE idx:catalog "*" GROUPBY 1 @category REDUCE AVG 1 @price AS avg_price SORTBY 2 @avg_price DESC`
  `FT.AGGREGATE idx:catalog "@category:{Audio}" LOAD 2 name price APPLY "@price - (@price * 0.1)" AS sale_price`
  `FT.AGGREGATE idx:catalog "*" GROUPBY 1 @brand REDUCE AVG 1 @rating AS avg_rating SORTBY 2 @avg_rating DESC` ("best brands leaderboard").
- Last step (/vector-search) is vector/hybrid; skipped. (Needs Redis 8.8+ per the tutorial index.)
- Node client search example (from /develop/clients/nodejs/queryjson): `await client.ft.create('idx:users', {'$.name': {type: SCHEMA_FIELD_TYPE.TEXT, AS:'name'}, '$.age': {type: SCHEMA_FIELD_TYPE.NUMERIC, AS:'age'}}, {ON:'JSON', PREFIX:'user:'})`; `client.json.set('user:1','$',obj)`; `client.ft.search('idx:users','Paul @age:[30 40]')` -> `.total`, `.documents[i].id`, `.value`; options `{RETURN:'city'}`; `client.ft.aggregate(idx,'*',{STEPS:[{type:FT_AGGREGATE_STEPS.GROUPBY, properties:'@city', REDUCE:[{type:FT_AGGREGATE_GROUP_BY_REDUCERS.COUNT, AS:'count'}]}, {type: FT_AGGREGATE_STEPS.SORTBY, BY:{BY:'@city',DIRECTION:'ASC'}}]})`; `client.ft.dropIndex('idx:users',{DD:true})` (DD deletes docs). For hash indexes use `ON: 'HASH'` and no field aliases needed. "From v5.0.0 onwards, node-redis uses query dialect 2 by default."
- Query syntax reference / dialects pages exist under /develop/ai/search-and-query/ but were not fetched individually.

---

## https://redis.io/docs/latest/develop/use/patterns/  -> REDIRECTS to https://redis.io/docs/latest/develop/clients/patterns/
- (meta-refresh redirect.) Index lists four subpages: distributed-locks, indexes (secondary indexing), bulk-loading, twitter-clone, all now under /develop/clients/patterns/.

## https://redis.io/docs/latest/develop/clients/patterns/distributed-locks
- Single-instance lock (doc "Correct Implementation"): acquire `SET resource_name my_random_value NX PX 30000`; value must be unique per client+request (doc suggests 20 bytes from /dev/urandom). Release safely only if value matches: `DELEX key IFEQ my_random_value` ("The DELEX command was introduced in Redis 8.4"); before 8.4 use the Lua script `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`. Plain DEL is unsafe (could remove another client's lock after yours expired).
- Why replica failover is not enough: replication is asynchronous; race: client A locks on master, master crashes before replicating, replica promoted, client B acquires same lock = "SAFETY VIOLATION". OK only if occasional double-holders are acceptable.
- Three properties: mutual exclusion, deadlock-free (TTL), fault tolerance (majority up).
- Redlock: N independent masters (doc example 5, no replication); get time; try all N in parallel with small per-node timeout (e.g. 5-50 ms for 10 s TTL); lock acquired if majority (N/2+1) obtained AND elapsed < validity time; validity = TTL - elapsed (minus clock drift); on failure unlock ALL instances; retry after random delay. Assumes bounded clock drift not synchronized clocks.
- Persistence: without persistence a restarted node can let a second client lock; AOF improves; default fsync every second may lose key after power loss; `fsync=always` for full safety (perf cost); alternative "delayed restarts" (keep crashed instance down > max TTL).
- Lock extension via Lua script that extends TTL only if value matches; limit number of re-acquisitions.
- Disclaimer (important caveat): "You should implement fencing tokens"; "Redis is not using monotonic clock for TTL expiration" so wall-clock jumps can break exclusion; points to Martin Kleppmann's critique and antirez's reply. Availability penalty equal to TTL under network partitions.
- Lists client implementations including node-redlock and redlock-universal (Node; supports node-redis, ioredis, lock extension, Cluster).

## https://redis.io/docs/latest/develop/clients/patterns/indexes (Secondary indexing)
- "Redis is not exactly a key-value store ... natively, Redis only offers primary key access." Indexes can be built with: hashes/JSON + Redis Search; sorted sets (numeric by score); sorted sets with lexicographic ranges (composite/graph indexes); sets (random index); lists (simple iterable, last-N); time series with labels. Advanced topic; consider a relational store for complex queries.
- Search field types listed: TEXT, TAG, NUMERIC, GEO, VECTOR, GEOSHAPE; queried via FT.SEARCH/FT.AGGREGATE after FT.CREATE.
- Sorted-set numeric index: `ZADD myindex 25 Manuel`, `ZRANGE myindex 20 40 BYSCORE` (add WITHSCORES / REV), `ZCOUNT` O(log N) regardless of range size. Better: store object IDs as members (`ZADD user.age.index 38 1` with `HMSET user:1 ...`), then fetch with HGETALL. Update index+object atomically with `MULTI/EXEC` (`HSET user:1 age 39` + `ZADD user.age.index 39 1`).
- Multi-dimensional -> linear: GEO uses geohash in the sorted-set score. Score limit: doubles represent integers exactly in +/- 2^53 (-9007199254740992..9007199254740992).
- Lexicographic indexes (all scores 0; `ZRANGE myindex [a (b BYLEX`): autocomplete (`ZRANGE myindex "[bit" "[bit\xff" BYLEX`), add frequency (`banana:1`, remove+re-add to update), normalize case/accents, key-value store (`mykey:myvalue`), zero-padded numeric strings (`00324823481:foo`), composite indexes (`0056:0028.44:90`, query `ZRANGE myindex [0056:0010.00 [0056:0030.00 BYLEX`). Updating lexicographic indexes requires removing old entry then adding new.

## https://redis.io/docs/latest/develop/clients/patterns/bulk-loading
- Naive one-command-at-a-time clients pay RTT per command; even pipelining needs to read replies while writing. Preferred: generate a file of raw Redis protocol and run `cat data.txt | redis-cli --pipe` (since 2.6; prints `errors: 0, replies: 1000000`). netcat approach (`(cat data.txt; sleep 10) | nc localhost 6379 > /dev/null`) is "not very reliable".
- Protocol format: `*<args>\r\n$<len>\r\n<arg0>\r\n...`, e.g. SET key value = `*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n`. Ruby generator shown (any language works).
- How --pipe works: sends as fast as possible, reads replies concurrently, at end sends `ECHO` with random 20-byte string and exits when that reply returns; counts replies.

## https://redis.io/docs/latest/develop/clients/patterns/twitter-clone (Retwis)
- Tutorial building a Twitter clone with Redis as ONLY database (PHP/Predis, originally 2009). Shows key-design patterns; this is a classic course capstone.
- Atomic INCR explanation: GET/+1/SET is racy, INCR is atomic.
- Data layout: unique ids via `INCR next_user_id`; user hash `HMSET user:1000 username antirez password p1pp0` (doc notes: hash passwords in real apps); lookup index hash `HSET users antirez 1000` (username->id; "no secondary indexes"); followers/following as sorted sets with follow time as score: `ZADD followers:1000 1401267618 1234`, `following:1000`; timeline as list `posts:1000` (every new post LPUSHed; "write fanout" pushes post IDs to each follower's list); lists use LRANGE/LTRIM; sets for membership/SINTER; hashes for users and updates.
- Page continues with authentication (auth token cookie stored in hash + reverse lookup), posts, pagination, following users, and scaling by key sharding (not read in detail).

---

## https://redis.io/docs/latest/develop/use/keyspace/ -> REDIRECTS to https://redis.io/docs/latest/develop/using-commands/keyspace/
- Keys: binary-safe strings, empty string valid, max key size 512 MB (but "very long keys are not a good idea": 1024-byte key is bad; hash big keys e.g. SHA1); "very short keys are often not a good idea" - prefer readable schema `object-type:id` like `user:1000`, `comment:4321:reply-to`; no namespaces, colon convention.
- Hashtags `{...}`: `{person}:1` and `{person}:2` land in same hash slot; needed for multi-key ops (e.g. SINTER) in cluster; "you shouldn't make a habit" - too many keys in one slot harms performance.
- Generic commands: EXISTS, DEL, TYPE (returns `none` for missing).
- Expiration: EXPIRE/PEXPIRE, `SET key 100 EX 10`, TTL/PTTL, PERSIST. "expire time resolution is always 1 millisecond"; expiry info is replicated and persisted, "time virtually passes when your Redis server remains stopped".
- SCAN: incremental, safe for production, "limited guarantees" while the collection changes; KEYS blocks server - "Don't use KEYS in your regular application code" (debugging/special ops only). Glob patterns: `h?llo`, `h*llo`, `h[ae]llo`, `h[^e]llo`, `h[a-b]llo`, `\` escape.

## https://redis.io/docs/latest/develop/use/pipelining/ -> REDIRECTS to https://redis.io/docs/latest/develop/using-commands/pipelining/
- Pipelining = send many commands without waiting for replies. Problem: RTT; example "if the RTT time is 250 milliseconds ... max four requests per second" even if server does 100k/s.
- Not just RTT: without pipelining each command costs read()/write() syscalls (context switch); with pipelining throughput "initially increases almost linearly ... eventually reaches 10 times the baseline". Ruby benchmark on loopback: "improved the transfer by a factor of five".
- WARNING: server queues replies in memory; send in batches (doc suggests e.g. 10k commands per batch).
- Pipelining vs scripting: scripts can read-compute-write in one step (pipelining cannot since later commands need earlier replies). EVAL/EVALSHA can be pipelined; use SCRIPT LOAD so EVALSHA cannot fail.
- Pipelines are NOT atomic (contrast with MULTI/EXEC).

## https://redis.io/docs/latest/develop/use/transactions/ -> 404; the real page is https://redis.io/docs/latest/develop/using-commands/transactions/
- Commands: MULTI, EXEC, DISCARD, WATCH, UNWATCH. Guarantees: commands serialized, no other client's request served in the middle; all-or-nothing relative to EXEC (disconnect before EXEC = nothing runs). With AOF a transaction is written with a single write(2); a crash can leave a partial transaction, detected at restart; fix with `redis-check-aof`.
- Inside MULTI each command replies `QUEUED`; EXEC returns array of replies in order.
- Errors: (1) queuing errors (bad syntax, OOM with maxmemory) -> EXEC refuses and discards whole transaction (since 2.6.5); (2) errors after EXEC (e.g. wrong type) -> other commands STILL run. "Redis does not support rollbacks" (simplicity/performance).
- Optimistic locking: `WATCH key` ... `MULTI` ... `EXEC`; if a watched key changed (including by expiry/eviction) EXEC returns Null reply and nothing runs; retry loop. Commands inside the transaction don't trigger WATCH. All keys unwatched after EXEC or disconnect; `UNWATCH` to flush. Example: implementing ZPOP atomically with WATCH.
- 8.4: new atomic compare-and-set/delete for strings: `SET ... IFEQ/IFNE/IFDEQ/IFDNE`, `DELEX` ("much simpler and faster" than WATCH for single string key).
- Scripts are transactional: "Everything you can do with a Redis Transaction, you can also do with a script, and usually the script will be both simpler and faster."

## https://redis.io/docs/latest/develop/use/client-side-caching/ -> REDIRECTS to https://redis.io/docs/latest/develop/reference/client-side-caching/ (plus intro at /develop/clients/client-side-caching/)
- Redis 6+ "Tracking": default mode (server remembers keys each connection read; sends invalidation when key modified/expired/evicted by maxmemory; costs server memory in an Invalidation Table with a max entries limit) and BCAST mode (clients subscribe to key prefixes `CLIENT TRACKING on REDIRECT 10 BCAST PREFIX object: PREFIX user:`; no server memory). Also OPTIN (`CLIENT TRACKING ON REDIRECT 1234 OPTIN`), OPTOUT, NOLOOP.
- Two-connection mode with RESP2 (invalidations delivered via Pub/Sub channel to the REDIRECT connection); RESP3 allows push messages on same connection.
- Invalidation namespace ignores DB numbers; FLUSHALL/FLUSHDB sends null.
- Client rules: bound local memory and evict; flush cache on connection loss; race conditions possible with two connections.
- Intro page: supported client versions: redis-py v5.1.0, Jedis v5.2.0, node-redis v5.1.0, go-redis v9.22.0. Commands NOT cached: @read commands for probabilistic and time series types, non-deterministic (HRANDFIELD, HSCAN, ZRANDMEMBER), FT.* search commands. "If any connection from a client gets disconnected ... the client will flush all keys from the client-side cache." Whole composite object and individual fields cached separately (JSON.GET $ vs $.field). Check with MONITOR.
- Node (connect page): needs node-redis v5.1.0+, server v7.4+ recommended for compatibility; `createClient({ RESP: 3, clientSideCache: { ttl: 0, maxEntries: 0, evictPolicy: "LRU" } })`; or `new BasicClientSideCache({...})` with `cache.invalidate(key)`, `cache.clear()`; opt-in/opt-out and broadcast modes NOT implemented by node-redis.

## https://redis.io/docs/latest/develop/use/keyspace-notifications/ -> REDIRECTS to https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/
- Pub/Sub events about data changes. `DEL mykey` in db 0 triggers `PUBLISH __keyspace@0__:mykey del` and `PUBLISH __keyevent@0__:del mykey`. Disabled by default (CPU). Enable with `notify-keyspace-events` (redis.conf or CONFIG SET); at least `K` or `E` needed. Flags: K keyspace, E keyevent, g generic, $ string, l list, s set, h hash, z zset, t stream, a array (new), d module, x expired, e evicted, m key-miss, n new, o overwritten, c type-changed; `A` = alias "g$lshztdxea" (excludes m,n,o,c). `KEA` for most events; `Kl` list-only keyspace events.
- Event names per command (e.g. LPUSH->lpush, SET->set, HSET->hset, XADD->xadd (+xtrim), EXPIRE->expire, expired, evicted).
- Caveat: Pub/Sub is "fire and forget"; missed events while disconnected are lost. `expired` events fire when Redis deletes the key (on access or background scan), NOT exactly when TTL reaches zero - "significant delay" possible. In cluster events are node-specific (subscribe to each node). History: key-miss events 6.0; `new` 7.0.

## https://redis.io/docs/latest/develop/pubsub/
- Commands: SUBSCRIBE, UNSUBSCRIBE, PUBLISH, PSUBSCRIBE (glob patterns `news.*`), PUNSUBSCRIBE; sharded (7.0): SSUBSCRIBE, SUNSUBSCRIBE, SPUBLISH.
- Delivery: "at-most-once"; subscriber that errors/disconnects loses message forever; use Streams for stronger guarantees. Messages in order of publishing.
- A RESP2 subscribed client may only issue (P|S)SUBSCRIBE/UNSUBSCRIBE, PING, QUIT, RESET; RESP3 (HELLO) allows any command. redis-cli in subscribed mode can't take commands (Ctrl-C).
- Message format: array [kind, channel, payload]; kinds subscribe/unsubscribe/message; patterns -> `pmessage` [pattern, channel, payload]; a client may receive one message twice if it matches both channel and pattern subscription.
- Not tied to keyspace or DB numbers: publishing on db 10 reaches subscriber on db 1; prefix channels with environment name for scoping.
- Sharded Pub/Sub: shard channels hashed to slots, messages only propagate within the shard, scales cluster Pub/Sub horizontally; global pub/sub broadcasts to every node.

## https://redis.io/docs/latest/develop/programmability/ , /eval-intro , /functions-intro
- Single engine: Lua 5.1, sandboxed. Two ways: EVAL (since 2.6.0; scripts are part of the app; cache is volatile) and Redis Functions (since 7.0; first-class DB objects, persisted and replicated).
- Atomicity: "script's execution blocks all server activities during its entire time" so slow scripts block all clients. Max execution time default 5 s via `busy-reply-threshold`; after that Redis replies BUSY to other clients; only SCRIPT KILL / FUNCTION KILL (if no writes yet) or `SHUTDOWN NOSAVE` allowed.
- EVAL syntax: `EVAL "return redis.call('SET', KEYS[1], ARGV[1])" 1 foo bar` (numkeys then keys then args). Rule: all key names a script touches MUST be passed as KEYS (needed for Cluster); never compute key names inside. `redis.call()` raises error to client; `redis.pcall()` returns error to script. Parameterize, don't generate script text (anti-pattern: fills script cache).
- Script cache: keyed by SHA1; `SCRIPT LOAD`, `EVALSHA`, `SCRIPT EXISTS`, `SCRIPT FLUSH`, `SCRIPT KILL`, `SCRIPT DEBUG`; always volatile (not persisted; lost on restart/failover) so handle `NOSCRIPT` by loading then retrying; in pipelines fall back to EVAL.
- Replication: effects replication (default since 5.0; script's write commands wrapped in MULTI/EXEC to replicas/AOF); verbatim replication removed in 7.0.
- Read-only scripts: `no-writes` flag or EVAL_RO / EVALSHA_RO / FCALL_RO; can run on replicas, killable, never OOM-fail.
- Functions: libraries loaded with `FUNCTION LOAD "#!lua name=mylib\nredis.register_function('knockknock', function() return 'Who\\'s there?' end)"`, called with `FCALL knockknock 0` (numkeys). Library needs >=1 registered function; library contents immutable (replace whole library with `FUNCTION LOAD REPLACE`, e.g. `cat mylib.lua | redis-cli -x FUNCTION LOAD REPLACE`); `FUNCTION LIST`, `FUNCTION DELETE`, `FUNCTION KILL`. Functions persist to AOF/RDB and replicate - "as durable as the data itself".
- Lua API reference at /develop/programmability/lua-api (not summarized here).

## https://redis.io/docs/latest/develop/clients/nodejs/ (node-redis guide) and subpages
- Package: `npm install redis`; "node-redis is the recommended client library for Node.js/JavaScript"; older `ioredis` still supported/documented; migration page exists (/nodejs/migration). Object mapping: RedisOM for Node.js.
- Connect: `import { createClient } from 'redis'; const client = createClient(); client.on('error', err => console.log('Redis Client Error', err)); await client.connect();` default localhost:6379. URL form: `createClient({ url: 'redis://alice:foobared@awesome.redis.server:6380' })`. `client.isReady`, `client.isOpen`; close with `await client.close()`.
- Basic: `await client.set('key','value')`, `client.get`, `client.hSet('user-session:123', {...})`, `client.hGetAll(...)` (command names are camelCase: hSet, hGetAll, incrBy, mSet, mGet, bitField, geoAdd, geoSearch, json.set, ft.search...). Hash values come back as strings.
- Pipelines/transactions (/nodejs/transpipe): node-redis auto-pipelines commands issued in the same event-loop tick, e.g. `await Promise.all([client.set('seat:0','#0'), ...])`; or `client.multi().set(...).set(...).execAsPipeline()`. Difference on connection loss: Promise.all pipeline continues from the interruption; multi() pipeline discards remaining. Transaction: `const [r1,r2,r3] = await client.multi().incrBy('counter:1',1)....exec()`. WATCH: `await client.watch('shellpath')`, read with plain `client.get`, then `client.multi().set(...).exec()`; if watched key changed the exec rejects (WatchError); retry in a loop. In shared-connection servers (web servers) must use a pool: `createClientPool()` and `pool.execute(async client => {...})`, catching `WatchError`, because "the server tracks the state of the WATCH on a per-connection basis".
- Pub/Sub (from migration page): subscribing connection can't issue other commands -> `const subscriber = client.duplicate(); await subscriber.connect(); await subscriber.subscribe('channel', (message) => {...});` (ioredis used `client.on('message')`). There is no dedicated pub/sub page in the node guide index.
- Other documented topics: Cluster `createCluster({rootNodes:[{url:'redis://127.0.0.1:16379'},...]})`; Sentinel `createSentinel({name:'mymaster', sentinelRootNodes:[{host,port}...]})` (replicaPoolSize to read from replicas; stale reads possible; separate `sentinelClientOptions`/`nodeClientOptions` credentials; no URL support); TLS (`socket: {tls: true, ...}`); error handling (error events, ECONNREFUSED/ETIMEDOUT/ECONNRESET retry with backoff, WRONGTYPE is not recoverable; patterns fail-fast, graceful degradation, retry w/ backoff, log-and-continue).
- Production usage: always set the `error` handler; default reconnect strategy is exponential backoff; `connectTimeout` default 5 s (`socket: {connectTimeout: 10000}`); per-command timeout via AbortController; offline queue may replay non-idempotent commands after reconnect -> `disableOfflineQueue: true` to discard instead.
- Probabilistic page (/nodejs/prob): Bloom/Cuckoo/CMS/Top-K/t-digest/HLL from node-redis (headings: set membership, cardinality, frequency, quantiles, ranking). JSON/Search page (/nodejs/queryjson) summarised above.
- NOTE: /develop/clients/nodejs/produce-consume does NOT exist (404).

---

## https://redis.io/docs/latest/develop/ai/search-and-query/ subpages used for query syntax (non-vector)
- /query: use FT.SEARCH for selection + projection; FT.AGGREGATE for mapping/grouping/aggregation. SQL comparison from doc: `SELECT * FROM bicycles WHERE price >= 1000` = `FT.SEARCH idx:bicycle "@price:[1000 +inf]"`; `SELECT id, price` = `FT.SEARCH idx:bicycle "*" RETURN 2 __key price`; discounted price = `FT.AGGREGATE idx:bicycle "*" LOAD 2 __key price APPLY "@price-@price*0.1" AS discounted`; group avg = `FT.AGGREGATE idx:bicycle "*" GROUPBY 1 @condition REDUCE AVG 1 @price AS avg_price`.
- /query/exact-match: numeric `@price:[270 270]`, `@price:[270]` and `@price==270` (DIALECT 2, needs v2.10), `FILTER price 270 270`; tag `@condition:{new}`, quoted tags `@email:{"test@redis.com"}` DIALECT 2; phrase `@description:"rough terrain"`.
- /query/range: `@price:[500 1000]`, exclusive `[(1000 +inf]`, `[-inf 2000]`, `FILTER price 500 1000`; "By default, FT.SEARCH returns only the first ten results" - page with `SORTBY field LIMIT offset count`.
- /query/full-text: single word, `@field: word`, prefix `ka*`, suffix `*bikes`, infix `*infix*`, fuzzy `%word%` (Levenshtein distance 1; `%%word%%` distance 2).
- /query/combined: AND = juxtaposition `(expr1) (expr2)`; OR = `|` e.g. `@description:(kids | small) @condition:{new | used}`; NOT = `-` e.g. `@price:[500 1000] -@condition:{new}`; numeric `FILTER`.
- /query/aggregation: `FT.AGGREGATE index "query" LOAD n field... APPLY "expr" AS name GROUPBY n @f REDUCE AGG_FUNC m args AS name`; reducers seen: AVG, SUM, COUNT, TOLIST. (Also /query/geo-spatial and /query/vector-search exist; vector skipped.) FT.SEARCH `RETURN` accepts `__key` for the key name.
- /indexing (JSON): `FT.CREATE ... ON JSON`, JSONPath per attribute, `AS` alias optional. Existing docs are indexed asynchronously in the background after FT.CREATE (so results may lag). "FT.SEARCH queries require attribute modifiers. Don't use JSONPath expressions in queries." TAG gotcha: hash TAG splits on `,` by default; JSON TAG does not (add `SEPARATOR ","`, or better use JSON arrays with `[*]`). Arrays can be indexed as TEXT (RediSearch v2.6.0+) or NUMERIC (v2.6.1+). `MULTI_TEXT_SLOP` default 100. SLOP/INORDER error if JSONPath yields multiple values. Multi-value JSONPath: strings indexed, null skipped, other types cause indexing failure.
- Licence of Redis Search: RSALv2 or SSPLv1 or AGPLv3 (tri-licence).

---

## https://redis.io/docs/latest/develop/reference/eviction/
- Eviction is meant for caches. `maxmemory` (redis.conf or `CONFIG SET maxmemory 100mb`); `0` = no limit, "the default behavior for 64-bit systems" (32-bit: implicit 3 GB). A single command can temporarily exceed the limit by a lot (e.g., big set intersection stored to new key).
- Replication/AOF buffers are NOT counted toward maxmemory (to avoid eviction feedback loops); leave RAM headroom; `INFO memory` -> `mem_not_counted_for_evict`.
- Policies (`maxmemory-policy`): `noeviction` (writes that add data error out; reads OK), `allkeys-lru`, `allkeys-lrm` (NEW 8.6: least recently modified), `allkeys-lfu`, `allkeys-random`, `volatile-lru`, `volatile-lrm`, `volatile-lfu`, `volatile-random`, `volatile-ttl`. volatile-* behave like noeviction if no keys have a TTL.
- Rules of thumb (doc): `allkeys-lru` default choice (Pareto); `allkeys-lrm` for read-heavy workloads where you want to evict data not recently modified; `allkeys-random` when all keys equally likely; `volatile-ttl` if you can assign short TTLs to eviction candidates. volatile-* policies suit mixing cache + persistent keys in one instance, but "consider running two separate Redis instances". Setting expire costs memory, so allkeys-lru is more memory efficient.
- Tuning with INFO: `keyspace_hits`, `keyspace_misses` (hit ratio = hits/(hits+misses)); `evicted_keys`; EXISTS on absent key counts as a miss.
- LRU is approximated by sampling: `maxmemory-samples` (default 5; 10 closely approximates true LRU at more CPU). LFU (4.0+) uses Morris counter with `lfu-log-factor` and `lfu-decay-time`.

## https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- Options: RDB (point-in-time snapshots), AOF (log every write), none, or both. RDB: compact single file `dump.rdb`, great for backups/DR/faster restart, but can lose minutes of data and fork() can pause serving (ms up to ~1 s on huge datasets). Config example `save 60 1000` (snapshot every 60 s if >=1000 changes); `SAVE`/`BGSAVE` manual.
- AOF: `appendonly yes`; `appendfsync always` (very slow, very safe), `everysec` (default and suggested; may lose 1 s), `no` (OS decides, ~30 s on Linux). Since 7.0 "multi part AOF": base file + incremental files + manifest in a directory named by `appenddirname`; background rewrite via `BGREWRITEAOF` (auto-rewrite configurable; `auto-aof-rewrite-percentage`). Truncated AOF: loads anyway if `aof-load-truncated` (default on); `redis-check-aof --fix` for corruption. AOF generally larger than RDB.
- Doc guidance: use both "if you want a degree of data safety comparable to what PostgreSQL can provide"; RDB alone if a few minutes of loss acceptable; AOF alone discouraged. If both enabled, on restart AOF is used.
- Interaction: no AOF rewrite while BGSAVE running and vice versa.
- Backups: RDB files are safe to copy while running (atomic rename); suggestion: hourly snapshots kept 48 h, daily for 1-2 months, off-machine copy daily. Backing up AOF during rewrite can be invalid: set `CONFIG SET auto-aof-rewrite-percentage 0`, check `aof_rewrite_in_progress`=0 via `INFO persistence`, copy, re-enable (hard-link trick).
- New: Redis 8.10.0 `BACKUP` command family for online self-contained backups (BASE rdb + INCR aof + manifest).
- Switching RDB -> AOF on a live server: enable via `redis-cli config set appendonly yes` FIRST (not just editing config and restarting) or data may be lost.

## https://redis.io/docs/latest/operate/oss_and_stack/management/replication/
- Leader-follower, asynchronous by default; replicas ack asynchronously. Mechanisms: command stream; partial resync after link break (PSYNC with replication ID + offset, uses master backlog); full resync (master BGSAVE RDB + buffer writes) otherwise. Non-blocking on master; replica can serve old data during initial sync (config).
- `WAIT numreplicas timeout` requests sync acks but does NOT make Redis CP: "acknowledged writes can still be lost during a failover".
- Config: `replicaof <ip> <port>` (or `REPLICAOF` command; `REPLICAOF NO ONE` to promote), `masterauth`, `replica-read-only` (default yes; writable replicas discouraged), diskless sync `repl-diskless-sync` / `repl-diskless-sync-delay`, `min-replicas-to-write` + `min-replicas-max-lag` (bound the data-loss window; master refuses writes if not satisfied), `replica-announce-ip`/`-port` for Docker/NAT.
- WARNING: master with persistence off + auto-restart can wipe all replicas (restarts empty; replicas sync from it). Either enable persistence on master or disable auto-restart. Also true with Sentinel.
- Replicas don't expire keys themselves; master sends DEL; replica hides logically expired keys on reads; during Lua scripts time is "frozen". Replication works even if the primary has persistence disabled? (see admin: replication causes RDB saves unless diskless).
- Replicas of replicas (cascading) allowed (since 4.0 all sub-replicas get same stream). Docker/NAT: INFO/ROLE report the NAT address, so set announce ip/port.

## https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/
- Sentinel = HA when not using Cluster: monitoring, notification, automatic failover, configuration provider (service discovery for clients). Sentinel 2 (Sentinel 1 with Redis 2.6 deprecated). Run: `redis-sentinel /path/to/sentinel.conf` or `redis-server /path/to/sentinel.conf --sentinel`; config file mandatory (state rewritten into it). Default port 26379 (must be open between Sentinels).
- Deploy rules: at least 3 Sentinel instances on independently-failing machines; async replication means acknowledged writes can be lost; clients need Sentinel support; test failover; "Sentinel, Docker, or other forms of NAT or port mapping should be mixed with care".
- Minimal config: `sentinel monitor mymaster 127.0.0.1 6379 2`, `sentinel down-after-milliseconds mymaster 60000`, `sentinel failover-timeout mymaster 180000`, `sentinel parallel-syncs mymaster 1`. Quorum only decides failure detection (ODOWN); failover needs majority of Sentinels to elect a leader ("no failover in the minority partition"). Replicas are auto-discovered. SDOWN (subjective) vs ODOWN (objective). Clients ask `SENTINEL get-master-addr-by-name <name>`; also `SENTINEL masters`, `SENTINEL replicas`, `SENTINEL sentinels`.

## https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/ (Redis Cluster)
- Page is "Scale with Redis Cluster". 16384 hash slots; slot = CRC16(key) mod 16384 (not consistent hashing). Hash tags: `user:{123}:profile` and `user:{123}:account` share a slot; multi-key ops/transactions/Lua only allowed if all keys in same slot. Cluster bus port = data port + 10000 (e.g. 16379) unless `cluster-port`. Minimum 3 master nodes (recommended 3 masters + 3 replicas). Config: `cluster-enabled yes`, `cluster-config-file`. Create: `redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 ...  --cluster-replicas 1`; `redis-cli --cluster reshard`, `check`, `add-node`, `del-node`, `fix`, `import`.
- No strong consistency (async replication; writes can be lost; minority partition stops after timeout). Cluster does not support NAT/Docker port mapping in general. Cluster becomes unavailable if majority of masters unavailable.
- Clients (node-redis): `createCluster({rootNodes: [...]})`.
- NOTE: the old "partitioning" page content is not at this URL; FAQ links here for sharding.

## https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/
- Small aggregate encodings: hashes, lists, integer-only sets, sorted sets stored compactly ("up to 10 times less memory", average 5x) while below limits; directives (defaults shown in page): `hash-max-listpack-entries 512`, `hash-max-listpack-value 64`, `set-max-intset-entries 512`, `set-max-listpack-entries 128`, `set-max-listpack-value 64`, `zset-max-listpack-entries 128`, `zset-max-listpack-value 64` (older ziplist/zipmap names also listed). Converts automatically to normal encoding when exceeded (CPU/memory trade-off; benchmark if raising).
- Tips: bitmaps (100M users flag = ~12 MB); prefer hashes for objects; "hash trick" to bucket small plain key-values: key `object:12` field `34` (~100 fields per hash; test showed 1.7 MB vs 11 MB on Redis 2.2); fragmentation: Redis may not return memory to OS, provision for PEAK memory; RSS/mem_used ratio unreliable after peaks; 32-bit builds use less memory but cap at 4 GB.
- Doc inconsistency: this page says hash fields "can't have an associated time to live", which is outdated vs hash field expiration since 7.4 (HEXPIRE). Flag if the course teaches both.

## https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/
- ACLs since Redis 6. Default user: `user default on nopass ~* &* +@all` (any connection can run any command). `requirepass` still works (sets default user's password). `AUTH <password>` or `AUTH <username> <password>`.
- Rule syntax: `on`/`off`; `+cmd`, `-cmd`, `+@category`, `-@category` (`+@all`, `ACL CAT` lists), `+config|get` subcommand form (7.0 for `-`); keys `~pattern`, `%R~`, `%W~`, `%RW~` (7.0), `allkeys`, `resetkeys`; channels `&pattern`, `allchannels`, `resetchannels` (6.2); passwords `>pw`, `<pw`, `#sha256hash`, `nopass`, `resetpass`; selectors `(rules)` (7.0); `reset`. Rules apply left to right.
- Example: `ACL SETUSER alice on >p1pp0 ~cached:* +get` -> `GET foo` fails `NOPERM ... keys`; `SET cached:1234` fails `NOPERM ... 'set' command`. New users start disabled with no commands/keys. 7.0 default `acl-pubsub-default` = `resetchannels`.
- Other: `ACL LIST`, `ACL GETUSER`, `ACL GENPASS`, external file via `aclfile /etc/redis/users.acl` + `ACL LOAD`, ACL categories incl. @read/@write/@fast/@slow; Redis 8 adds @search, @json, @timeseries, @bloom, @cuckoo, @cms, @topk, @tdigest (from 8.0 release notes). Use cases: least privilege + operational safety (e.g. worker without FLUSHALL).

## https://redis.io/docs/latest/operate/oss_and_stack/management/admin/
- Linux: set `vm.overcommit_memory = 1`; disable Transparent Huge Pages (`echo never > /sys/kernel/mm/transparent_hugepage/enabled`); keep swap equal to RAM; set explicit `maxmemory` (account for overhead + fragmentation); during RDB save/AOF rewrite memory can reach up to 2x in write-heavy apps; set replication backlog in proportion to memory; replication triggers RDB saves even with persistence off unless diskless; ensure master has persistence or no auto-restart.
- Security: "By default, Redis does not require any authentication and listens to all the network interfaces." (do not expose to the internet).
- Zero-downtime upgrade: start new instance as replica, wait sync, compare key counts via INFO, `CONFIG SET slave-read-only no`, switch clients (consider `CLIENT PAUSE`), verify no traffic with MONITOR, `REPLICAOF NO ONE`, shut old down. With Sentinel/Cluster: upgrade replicas one by one then manual failover.
- Tools: `LATENCY DOCTOR`, `MEMORY DOCTOR`.

---

## Docker and packaging facts (consolidated; sources: redis.io docs + Docker Hub API as of 2026-11-01)
Sources: redis.io/docs install pages; redis.io Redis OS 8.0 release notes; Docker Hub repository pages for `redis`, `redis/redis-stack`, `redis/redis-stack-server`, `redis/redisinsight` (queried via hub.docker.com API; these are not redis.io/docs pages and are labelled).
1. Redis Stack vs Redis 8: Redis Stack is superseded. redis.io /operate/oss_and_stack page description: "Redis 8 in Redis Open Source replaces Redis Stack." Release notes 8.0.0 (May 2025): "Redis 8.0 deprecates previous Redis and Redis Stack versions. Stand alone RediSearch, RedisJSON, RedisTimeSeries, and RedisBloom modules are no longer needed as they are now part of Redis." Also: "Redis Search and 8 new data structures are now an integral part of Redis 8" = Redis Search, JSON, time series, five probabilistic types (Bloom, Cuckoo, Count-min sketch, Top-k, t-digest), plus Vector set (preview); "These nine components are included in all binary distributions" (incl. Alpine and Debian Docker images). New config file `redis-full.conf` loads all components. Supported upgrade paths include "From Redis Stack 7.2 or 7.4". Naming: "Redis Community Edition is now Redis Open Source".
   Docker Hub `redis/redis-stack` description note: "New users should use Redis instead of Redis Stack. Starting with Redis 8, we are combining our Redis Stack and community offerings into a single Redis Open Source distribution. All Redis Stack modules are included in Redis Open Source. We stopped releasing maintenance updates for Redis Stack (6.2, 7.2, and 7.4) in December 2025." Both redis-stack images last pushed 2025-11-03 (tags like 7.4.0-v8, 7.2.0-v20). Redis.io keeps the old Stack Docker instructions only under an "archive" path (/operate/oss_and_stack/install/archive/install-stack/docker).
2. Official image for the course: `redis` (Docker Official Image, Docker Hub library/redis, maintained by Redis LTD). Run: `docker run -d --name redis -p 6379:6379 redis` (redis.io: `redis:<version>`). Connect: `docker exec -it redis redis-cli` or `redis-cli -h 127.0.0.1 -p 6379`.
   Tags on Docker Hub today: `8.10.3` = `8.10` = `8` = `latest` (= `trixie`, Debian 13 based); alpine variants `8.10.3-alpine`, `8.10-alpine`, `8-alpine`, `alpine` (alpine3.23). Other supported lines: 8.8.4, 8.6.8, 8.4.8 (trixie/alpine), 8.2.11 (bookworm/alpine), 7.4.12, 7.2.17, 6.2.24. Architectures: amd64, arm32v5/v6/v7, arm64v8, i386, ppc64le, riscv64, s390x. Image last updated 2026-10-29; pull_count ~11.6 billion.
   Docs features cited in this digest need a recent line: Arrays, INCREX, XNACK need >= 8.8; LMOVEM, compact hashes/HIMPORT, BACKUP, TS.NRANGE need 8.10; LRM eviction, stream idempotency, TS NaN need >= 8.6; DELEX / SET IFEQ / MSETEX / DIGEST need >= 8.4; stream XACKDEL/XDELEX need >= 8.2; HGETEX/HSETEX/HGETDEL >= 8.0; hash field expiration >= 7.4. Docs page itself does not say which Docker tag has which; use `redis:8` (moves with the 8.x line) or pin `redis:8.10`.
3. Which image includes JSON/Search/TimeSeries/Bloom: per release notes (point 1) all Redis 8 distributions including the official Docker images (Alpine and Debian) include them; plain `redis:8.x`/`redis:latest` is enough, no `redis-stack` image or module loading needed. NOT explicitly stated on the Docker Hub `redis` page; the statement comes from the Redis 8.0 release notes ("included in all binary distributions", lists "Alpine and Debian Docker images" as binary distributions) and the redis-stack Hub note. (Not empirically verified by running a container.)
4. RedisInsight: renamed "Redis Insight" in docs. Separate image `redis/redisinsight` (latest = 3.8.0 as of 2026-07-21 on Docker Hub). Run: `docker run -d --name redisinsight -p 5540:5540 redis/redisinsight:latest`; persist data: `docker run -d --name redisinsight -p 5540:5540 -v redisinsight:/data redis/redisinsight:latest` (volume dir must be writable by uid 1000). UI at `http://localhost:5540`; health check `http://localhost:5540/api/health/`; API docs at `http://localhost:5540/api/docs`. (Docker Hub page prints the persistent example with `-v` after the image name, which would be treated as container args; redis.io has it before the image name - use that.) Licence: SSPL (develop/tools/insight page).
   The old bundle image `redis/redis-stack` (archived) = Redis Stack server + Redis Insight; `docker run -d --name redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest` -> Insight on `localhost:8001`. `redis/redis-stack-server` = server only ("best for production"). The new `redis` image does NOT bundle Insight; run `redis/redisinsight` alongside (port 5540). To have Insight reach the redis container use a shared Docker network / host address (not stated in docs; Docker networking general knowledge).
5. Ports: Redis 6379 (TCP). Insight (standalone) 5540; Insight inside redis-stack 8001. Sentinel 26379. Cluster bus = data port + 10000. (From the docs above.)
6. Persistence in Docker: data directory is `/data` (VOLUME). redis.io: `docker run -v /local-data/:/data --name redis -p 6379:6379 redis:<version>`. Docker Hub: `docker run --name some-redis -d redis redis-server --save 60 1 --loglevel warning` (RDB snapshot every 60 s if >=1 write); "If persistence is enabled, data is stored in the VOLUME /data". For AOF add `--appendonly yes` (inferred from the persistence page: `appendonly yes`; the Docker pages show the flag only for redis-stack: `docker run -e REDIS_ARGS="--save 60 1000 --appendonly yes" redis/redis-stack:latest`). Mounted directory must be writable; Redis (8.0.2+) tries to fix ownership/permissions of data and config dirs; skip with `SKIP_FIX_PERMS=1`; image drops privileges to the `redis` user unless `--user` or `SKIP_DROP_PRIVS=1` (since 8.0.2).
   Custom config: `docker run -v /myredis/conf:/usr/local/etc/redis --name myredis redis redis-server /usr/local/etc/redis/redis.conf` (mounted dir must be writable) or Dockerfile `COPY redis.conf /usr/local/etc/redis/redis.conf; CMD [ "redis-server", "/usr/local/etc/redis/redis.conf" ]`.
   Security (Docker Hub): "Protected mode" is turned off by default in the image, so a published port (`-p`) is open without password to anyone who can reach the host; set a password via config (`requirepass`) or bind the host side to localhost (`-p 127.0.0.1:6379:6379`, my suggestion, not from the docs).
7. Licences: Redis >= 8.0 tri-licensed: RSALv2, SSPLv1, or AGPLv3 (choice of licensee). Redis 7.4.x-7.8.x: dual RSALv2 or SSPLv1 (Hub text says "7.4.x-7.8.x"). Redis <= 7.2.4: 3-clause BSD. Redis Search features: RSALv2/SSPLv1/AGPLv3. Redis Insight: SSPL. Docker images also contain base-distro software under other licences. Node client `redis` package licence is not stated on the docs page.
8. Other install paths from redis.io (tested platforms: Ubuntu 22.04/24.04/26.04, Rocky/Alma 8.10/9.7/10.1, Debian 12/13, Alpine 3.23, macOS 14/15/26): APT (packages.redis.io, `sudo apt-get install redis`), RPM (Rocky/Alma), snap, Homebrew (`brew install redis`; `brew services start redis`), Docker; Windows only via Docker (Memurai preview of 8.2 RC1). redis-cli alone: /install-stack/install-redis-cli page exists.

---

## Use-case pages (VENDOR MARKETING pages under https://redis.io/solutions/, not technical docs; many describe Redis Enterprise/Cloud, not OSS)
- Index (/solutions/): lists Vector database, Caching, Feature stores (links to /feature-form/), Inventory management (/solutions/real-time-inventory/), Session management, Deduplication, Fast data ingest, Authentication token storage, Leaderboards, Messaging, plus (from menu) Fraud detection, Real-time decisions, Flex, session-store, ai-cost-optimization. No /solutions/rate-limiting page (404).
- Caching (/solutions/caching/): patterns named: cache-aside (most common; app talks to cache and DB), query caching (cache-aside for repeated SQL queries), write-behind (write to cache, async to DB), write-through (sync update flowing to DB), cache prefetching (replicate from system of record into cache continuously). Data structures/commands named: none specific (key:value). Marketing claims (vendor-published, Redis Enterprise): sub-ms latency, "up to 200 million operations per second", "99.999% uptime SLA", "up to 80% savings" with tiered storage.
- Leaderboards (/solutions/leaderboards/): Sorted Sets (ZSETs); commands named ZADD, ZRANGE, ZRANGEBYSCORE, ZRANK, ZINCRBY, ZUNIONSTORE (for global vs per-tournament boards); pairs sorted set (score + id) with Hash per player (`player:100`, HGETALL); Node.js `npm install redis`. Types: absolute (Top 10) vs relative leaderboards.
- Messaging (/solutions/messaging/): Pub/Sub for lightweight broadcast, Streams for persistent event sourcing/streaming, Lists for simple queues, Sorted Sets for priority queues; persistence via RDB/AOF.
- Session management (/solutions/session-management/) and session store (/solutions/session-store/): session state as key-value (user id -> session data); sessions are not like a cache (cache can be rebuilt from DB; session state may be only in Redis, so durability matters); example uses Node.js express session store + MySQL, persisting session to DB on logout. Names no Redis commands. Authentication token storage (/solutions/authentication-token-storage/): store IdP-issued token in Redis for the session duration; no commands named.
- Deduplication (/solutions/deduplication/): Redis Sets for exact dedupe, Bloom and Cuckoo filters for probabilistic dedupe (customer quote: Liftoff uses Cuckoo filter on 1.5 TB DB for ad devices - vendor testimonial).
- Fast data ingest (/solutions/fast-data-ingest/): Streams (XADD, XREAD, XRANGE with Jedis examples; consumer groups), Pub/Sub, Lists and Sorted Sets as channels, Time Series (downsampling, compaction); claims "200 million read/write operations per second ... 40-node cluster" (vendor benchmark, Enterprise).
- Real-time inventory (/solutions/real-time-inventory/): store inventory positions in Redis (Ulta Beauty quote), geospatial indexing for "local store search" (real-time available-to-promise, store/region inventory), search/query for items; Active-Active geo-distribution (Enterprise only). Names no commands.
- Fraud detection (/solutions/fraud-detection/): real-time transaction risk scoring, digital identity profiles updated in real time, Bloom filter check of a transaction against known fraudulent patterns; "22 million read/write operations per second" benchmark (vendor). Real-time decisioning (/solutions/real-time-decisioning/): JSON for profiles, TimeSeries for behaviours, Streams for event ordering, vectors/feature store; claims "<10ms end-to-end" (vendor; AI-heavy, mostly out of scope).
- Flex (/solutions/flex/): RAM+NVMe tiering (Redis Cloud/Software product), not OSS.
- Rate limiting is NOT under /solutions/. The developer tutorial https://redis.io/tutorials/howtos/ratelimiting/ (Mar 20, 2026; technical but hosted on redis.io, not /docs) builds 5 limiters with Node/Bun + Lua via EVAL: fixed window (STRING + Lua, allows 2x burst at boundaries), sliding window log (SORTED SET + Lua, exact, O(n) entries), sliding window counter (2 STRINGs + Lua; "best balance of accuracy, simplicity, and low memory usage" for most APIs), token bucket (HASH + Lua, controlled bursts), leaky bucket (HASH + Lua, policing or shaping). Argues Lua beats MULTI/EXEC (can't branch on read values) and WATCH (retry storms); warns Lua blocks the event loop; in Cluster all script keys must share a slot (use hash tags). Repo: redis-developer/redis-ratelimiting-js. Glossary page /glossary/rate-limiting/ (marketing) lists IP-based, user-based, application-based, token bucket. Docs-side hints: sorted-set page names sliding-window rate limiter; new INCREX (8.8.0) has `ENX` flag "to ensure a window counter rate limiter's TTL is set only when it is created", options `BYINT`/`BYFLOAT`, `LBOUND`/`UBOUND`, `SATURATE`, `EX/PX/EXAT/PXAT/PERSIST`, returns [new value, applied increment].
- Not found as pages: caching "session management" overlap with hash field expiration (docs hashes page) - use the technical docs, not marketing, for commands.

---

## URLs that failed or redirected (as of 2026-11-01)
404:
- https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/install-redis-on-docker/ (404). Use /operate/oss_and_stack/install/install-stack/docker/ (200, titled "Run Redis Open Source on Docker").
- https://redis.io/docs/latest/develop/use/transactions/ (404). Real page: /develop/using-commands/transactions/ .
- https://redis.io/docs/latest/develop/clients/nodejs/produce-consume (404, guessed URL; not in node guide index).
- https://redis.io/solutions/rate-limiting/ (404; also /solutions/rate-limiter/).
- https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglog and /develop/data-types/hyperloglogs (404). Correct: /develop/data-types/probabilistic/hyperloglogs/ .
- https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/ (404).
Redirected (meta refresh, page shows 200 but forwards):
- /develop/use/patterns/ -> /develop/clients/patterns/ (subpages: distributed-locks, indexes, bulk-loading, twitter-clone)
- /develop/use/keyspace/ -> /develop/using-commands/keyspace/
- /develop/use/pipelining/ -> /develop/using-commands/pipelining/
- /develop/use/client-side-caching/ -> /develop/reference/client-side-caching/ (intro at /develop/clients/client-side-caching/)
- /develop/use/keyspace-notifications/ -> /develop/pubsub/keyspace-notifications/
- /develop/get-started/document-database -> /develop/get-started/search-tutorial/
- /develop/get-started/vector-database -> /develop/get-started/search-tutorial/vector-search/ (skipped)
- /solutions/feature-stores/ -> /feature-form/ (not read; ML/AI)
- https://redis.io/learn/howtos/ratelimiting -> https://redis.io/tutorials/howtos/ratelimiting/
Not 404 but note: https://redis.io/docs/latest/develop/ai/search-and-query/ is still the Search path even though "ai" is in the URL; the data-store page links "Next steps: Redis as a document database / vector database" to the Search tutorial.
Pages not fetched / not read in full: Lua API reference (/develop/programmability/lua-api), Search reference (query syntax/dialects/FT.CREATE option reference pages), Redis Insight feature pages, vector-search subpages, Redis Cloud pages, node-redis amr/observability/vecsearch/vecsets pages, Twitter-clone sections after "Data layout" were skimmed by heading only, Sentinel page sections after "Other Sentinel options" (SDOWN/ODOWN detail, Docker notes) not read in full, Cluster page tutorial details not read in full.

---

# ADDITIONAL SECTIONS: official "Available use cases" (technical docs, added on coordinator request)
These live under /develop/use-cases/ (note the URL names differ from guesses: `rate-limiter`, `session-store`, `leaderboard`, `pub-sub`; others as named). Each has an overview page plus one guide per client (dotnet, go, java-jedis, java-lettuce, nodejs, php, redis-py, ruby, rust). Details below come from the overview AND the Node.js (node-redis 5.x) guide of each. All guides ship a small runnable demo (an HTTP server on a localhost port with a UI, e.g. 8080; job queue demo 8791) with 2-4 source files downloaded from github.com/redis/docs/.../use-cases/<name>/nodejs. Not all demos expose Redis version requirements; where stated, quoted.

## https://redis.io/docs/latest/develop/use-cases/
- Index lists 13 use cases. In scope here: Rate limiting ("token bucket"), Session storage ("TTL-based expiration"), Time series dashboard ("rolling sensor graph demo"), Leaderboards ("sorted sets and user metadata"), Cache-aside ("TTL-bounded staleness"), Job queue ("at-least-once delivery and visibility-timeout reclaim"), Prefetch cache ("kept current by a CDC sync worker"), Pub/sub messaging ("channel and pattern subscriptions"), Streaming ("consumer groups, replay, and configurable retention"). Skipped (AI): recommendation-engine, feature-store, semantic-cache, memory-layer.
- Common page shape: When to use / Why the problem is hard / What you can expect / How Redis supports the solution / Ecosystem (libraries) / per-client guides. Common production advice across guides: namespace keys per app, keep values small, reconcile from a durable source, one shared node-redis client except for blocking or subscribe connections (use `client.duplicate()`).

## https://redis.io/docs/latest/develop/use-cases/rate-limiter  (+ /nodejs)
- Recommended approach: TOKEN BUCKET implemented as a Lua script run with EVAL/EVALSHA ("Token bucket rate limiter with Redis and Node.js"). Use Redis for a centralised quota across instances (local per-process counters "break behind load balancers").
- Overview features named: INCR + EXPIRE (atomic fixed-window counters, auto cleanup), hashes/sorted sets/strings for sliding window and token bucket, hash field expiration (HEXPIRE, Redis 8), Lua via EVAL to keep read-decide-update atomic ("concurrent requests cannot double-spend tokens or lose counter updates"), Active-Active for cross-region (Enterprise). Ecosystem: rate-limiter-flexible, express-rate-limit (Node), limits (Python), go-redis/redis_rate, gateways APISIX/Kong/Envoy.
- Token bucket data: one hash per limited subject, fields `tokens` and `last_refill`; commands in script: `HMGET key tokens last_refill`, math (refills = floor(elapsed/refill_interval); tokens = min(capacity, tokens + refills*refill_rate)), consume 1 token if >= 1, `HMSET key tokens last_refill`; returns `{allowed, tokens}`. Script args: KEYS[1]=key; ARGV capacity, refill_rate, refill_interval, now. (The token-bucket script takes `now` from the client; the alternative algorithms use `redis.call('TIME')` to avoid clock drift between app servers.) No key expiry in the token bucket script ("though not used in this implementation").
- Node API: `new TokenBucket({redisClient, capacity: 10, refillRate: 1, refillInterval: 1.0})`; `await limiter.allow('user:123')` -> `{allowed, remaining}`; script cached via SCRIPT LOAD/EVALSHA with automatic fall back to EVAL on NOSCRIPT. Examples: capacity 10 refill 1 per 1 s = 1 rps with burst 10; capacity 100 refill 10/s; capacity 60 refill 1 per 60 s.
- Key naming: `user:{userId}`, `ip:{ipAddress}`, `api:{endpoint}:{userId}`, `global:api`.
- HTTP: set `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; on deny return 429 with `Retry-After`. Express middleware example with key function (`ip:${req.ip}`).
- Failure modes: `allow()` throws if connection lost -> "Fail open or closed depending on your policy". Atomicity needed to avoid double spending, lost updates, inconsistent state.
- Variations (comparison table in the page): token bucket (1 hash key, exact, controlled bursts); fixed window counter (1 string; INCR then EXPIRE on count==1, PTTL for retry; approximate; "2x requests" burst at window boundary); sliding window log (sorted set; `ZREMRANGEBYSCORE key -inf cutoff`, `ZCARD`, `ZADD key now member` with UUID member, `EXPIRE key window*2`, oldest via `ZRANGE key 0 0 WITHSCORES` for retry-after; exact, no bursts, O(n) memory); sliding window counter (two string keys per window using hash tag `{key}`, weighted average of current and previous window; near-exact; 2 keys); leaky bucket (policing) (hash with `level` and `last_leak`, HGETALL/HSET/EXPIRE; exact, no bursts, overflow rejected immediately). Related: leaky bucket "shaping" mentioned elsewhere (tutorial).

## https://redis.io/docs/latest/develop/use-cases/session-store  (+ /nodejs)
- Recommended approach: one HASH per session, key `session:{session_id}`, with a SLIDING TTL (EXPIRE reset on every read). Browser cookie holds only an opaque random session id (`crypto.randomBytes(32).toString('base64url')`); `sid` cookie `Path=/; HttpOnly; SameSite=Lax` (add `Secure` on HTTPS).
- Hash fields: caller data (strings) plus reserved `created_at`, `last_accessed_at`, `session_ttl`. Commands: `HSET` + `EXPIRE` in a MULTI (create), `HGETALL` (read), then MULTI of `HSET last_accessed_at` + `EXPIRE` + `HGETALL` (refresh), `HINCRBY` (counters like page_views), `DEL` (logout). Example default TTL 1800 s. Class API: `new RedisSessionStore({redisClient, ttl: 1800})`; `createSession`, `getSession(id, refreshTtl)`, `incrementField`, `deleteSession`.
- Overview extras: Sets (SADD/SMEMBERS/SREM) to track all sessions per user for multi-device and logout-all (`DEL` + `SREM`); AOF/RDB so sessions survive restarts within their TTL; Redis Search for cross-session queries (e.g., carts of an affected tenant) without key scanning; eliminates sticky sessions.
- Trade-offs/warnings: sliding expiration "defines how long a hijacked cookie remains useful": use shorter inactivity TTLs, a separate absolute expiry cap, rotate session ID after login/privilege change; keep session data small (IDs, usernames, flags), keep large blobs elsewhere; don't put profile/role data in cookies; use framework middleware (Express, Fastify, Next.js) in real apps. Variations: separate metadata keys, per-user session sets, secondary index via Search.

## https://redis.io/docs/latest/develop/use-cases/time-series-dashboard  (+ /nodejs)
- Recommended approach: one Redis time series key per metric/sensor with LABELS and a short RETENTION; ingest with TS.MADD; query raw with TS.RANGE and downsampled buckets with `TS.RANGE ... ALIGN 0 AGGREGATION min|max|avg 3000`; compaction via TS.CREATERULE for multi-tier downsampling (raw -> 1 min avg -> 1 h avg); cross-series queries with `TS.MRANGE ... FILTER label=value`.
- Demo: 3 simulated power sensors, readings every 500 ms, graph shows last 12 s (RETENTION 12 s so samples visibly expire), 3-second buckets with min/max/avg. Key names: `ts:sensor:power_consumption:{sensor_id}` (e.g. `ts:sensor:power_consumption:power-1`). Labels: `site=demo`, `sensor_type=power_consumption`, `sensor_id=power-1`, `zone=north`, `unit=watts`. Commands used: TS.CREATE (retention + labels; idempotent setup so restart is safe), TS.MADD (batch every 500 ms), TS.GET (latest), TS.RANGE. node-redis called via generic `sendCommand()`. `ALIGN 0` keeps bucket boundaries stable while the window moves.
- Overview claims: time series suit high write volume, replace fragile sorted-set/Lua approximations; aggregators avg,sum,min,max,count,std.p,std.s,twa; RETENTION trims relative to newest sample (no EXPIRE needed); not a replacement for petabyte cold archival (InfluxDB/TimescaleDB mentioned); Streams are a different tool (event log).
- Prereq: deployment must include time series (included in Redis 8). Production notes: auth, separate static assets, health checks, deployment-specific retention/window/aggregation intervals, stronger key namespacing for shared Redis. Variation ideas: compaction rules, label-based MRANGE.

## https://redis.io/docs/latest/develop/use-cases/leaderboard  (+ /nodejs)
- Recommended approach: SORTED SET per board (key `leaderboard:demo`, member = user id, score = rank value) + one HASH per user for metadata (`leaderboard:demo:user:{id}` fields name, description...). Keeps the zset small.
- Commands: ZADD (add/update; written in a MULTI with HSET), ZINCRBY (atomic increment, "no read-modify-write cycle"), `ZRANGE ... REV` with `LIMIT` for top-N, ZREVRANK for a user's rank, "around me" window computed from rank (start = rank-1-floor(count/2), clamped), ZREMRANGEBYRANK to trim to `maxEntries` (demo 100) then DEL metadata hashes of trimmed users, HSET/HGETALL for metadata, ZUNIONSTORE + per-window keys with EXPIRE for daily/weekly/monthly boards. Class: `new RedisLeaderboard({redisClient, key, maxEntries})` with `upsertUser`, `incrementScore`, `getTop`, `getAroundRank`.
- Claims (docs, not audited): all ops O(log N); "millions of ranked members in roughly 500 MB of RAM"; ranking in an RDBMS needs ORDER BY O(N) (seconds at millions of rows). Distinct from Streams and from Top-K (approximate, no exact ranks).
- Pitfalls: ties break by member lexicographic order (encode tie-breaker in score or elsewhere); decide expiry/archive (namespace keys per season/event, snapshot history elsewhere, rebuild from upstream); keep metadata hashes light; "tighter concurrency control" and validation needed in production.

## https://redis.io/docs/latest/develop/use-cases/cache-aside  (+ /nodejs)
- Recommended approach: CACHE-ASIDE with bounded TTL, invalidate (DEL) on write, plus a Lua "single-flight" lock for stampede protection. Entity stored as HASH at `cache:product:{id}` (fields id, name, price_cents, stock) with TTL (demo 30 s). Key prefix advice: `cache:{app}:product:{id}` in shared Redis.
- Read flow: `HGETALL`; hit -> return; miss -> acquire lock key via Lua `SET lockKey token NX PX lockTtlMs` -> winner calls loader (primary DB), then MULTI `DEL` + `HSET` + `EXPIRE`, releases lock with Lua `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`; losers poll the cache every `waitPollMs` until lock TTL deadline, then fall back to the loader. Stats: hits, misses, stampedesSuppressed; `TTL` shown for staleness.
- Write flow: update primary then `DEL cache key` ("never try to keep the cache and primary in sync directly, just delete"). Field update path: `WATCH` + `EXISTS` + `MULTI HSET + EXPIRE EXEC` retry loop, only writes if already cached so a partial record never appears.
- Overview extras: JSON path caching (JSON.SET/GET) as alternative; probabilistic early refresh named as another stampede option; claims P95 < 5 ms. Distinct from write-through/write-behind and semantic caching.
- Production notes: pick TTL = staleness tolerance (shorter TTL = lower hit rate); cache "not found" sentinels with a shorter TTL; lock TTL must exceed worst-case primary read latency; token makes lock release safe; inspect with `redis-cli HGETALL cache:product:p-001` / `TTL`.

## https://redis.io/docs/latest/develop/use-cases/job-queue  (+ /nodejs)
- Recommended approach: reliable list queue with VISIBILITY-TIMEOUT RECLAIM: pending list -> atomic `BLMOVE pending processing RIGHT LEFT timeout` (successor of BRPOPLPUSH, needs Redis 6.2+; node-redis v5 removed brPopLPush) -> worker completes/fails -> a periodic reclaimer returns stuck jobs to pending. Delivery is at-least-once.
- Key naming (queueName prefix `queue:jobs`): `queue:jobs:pending` (list; enqueue with LPUSH, oldest at right), `queue:jobs:processing` (list), `queue:jobs:completed` (LTRIM-capped history, demo 50), `queue:jobs:failed` (capped), `queue:jobs:job:{id}` (hash: id, payload (JSON string), status pending|processing|completed|failed, attempts, enqueued_at_ms, claimed_at_ms, claim_token, completed_at_ms, result, last_error), `queue:jobs:events` (Pub/Sub channel for completion notifications via PUBLISH).
- Flow/commands: enqueue = MULTI(HSET meta + LPUSH id) with random 8-byte hex id; claim = BLMOVE then MULTI(HSET status/claimed_at_ms/claim_token + HINCRBY attempts + HGETALL) with per-claim random token; complete/fail/reclaim = Lua scripts called with EVALSHA (script preloaded with SCRIPT LOAD, fallback to EVAL on NOSCRIPT); script checks the claim_token first and returns 0 if the worker no longer owns the job (fenced); complete = LREM from processing + write result + LPUSH history + LTRIM + EXPIRE hash; fail = retry (back to pending) while attempts < maxAttempts (default 3) else move to failed; EXPIRE on completed/failed hashes for cleanup. Stats via LLEN of the four lists. API: `new RedisJobQueue({redisClient, visibilityMs: 5000})`, `enqueue`, `claim(timeoutMs)`, `complete`, `fail`, `reclaimStuck`.
- Reclaimer: periodic sweep over processing list moves jobs whose claimed_at_ms older than visibility timeout back to pending; also handles a crash between BLMOVE and writing claimed_at_ms (reclaimed after 2 x visibility_ms using enqueued_at_ms).
- Failure modes/trade-offs: too-short visibility timeout duplicates work for slow healthy jobs; too long delays crash detection; at-least-once means non-idempotent side effects (e.g., Stripe charge) need idempotency keys or low retry count; someone must run the reclaimer on a schedule (setInterval or separate scheduler or each worker before claim); cap history lists (use a Stream for long audit); use one shared client except a dedicated connection for long blocking BLMOVE; node-redis multiplexes on one connection.
- Overview variations: FIFO/LIFO/priority/delayed queues (sorted sets with ZADD + ZRANGEBYSCORE scored by run-at time or priority); Streams + consumer groups for fan-out; Pub/Sub for completion signalling; libraries Sidekiq, Celery, Bull/BullMQ, RQ. Demo: worker pool with configurable fail/hang rates and "Run reclaim sweep" button.

## https://redis.io/docs/latest/develop/use-cases/prefetch-cache  (+ /nodejs)
- Recommended approach: PREFETCH (pre-load) cache for reference/master data kept current by a CDC SYNC WORKER; reads hit Redis ONLY (no fall-back to primary on miss; a miss is an error/incident). Safety-net long TTL (demo 3600 s) refreshed on every sync upsert; not a freshness mechanism.
- Key naming: `cache:category:{id}` HASH (id, name, display_order, featured, parent_id); prefix configurable (`cache:billing:category:{id}` for shared Redis).
- Flow: startup `bulkLoad(records)` = pipelined (`multi().execAsPipeline()`) `DEL` + `HSET` + `EXPIRE` per record in one round trip (non-atomic OK because nothing reads yet; also used for live `/reprefetch`); read = `HGETALL` only; sync event `upsert` = MULTI(`DEL` + `HSET` + `EXPIRE`) (DEL first so dropped fields don't linger), `delete` = `DEL`; `SCAN` to enumerate/clear prefix and audit coverage; `TTL` shown in UI. Demo replaces CDC with an in-process change queue + async SyncWorker; production CDC = Redis Data Integration (RDI), Debezium (+Kafka or a Redis stream) with consumer; Streams (XADD/XREAD) named as the durable replayable change feed to resume from an offset.
- Trade-offs/failure modes: whole working set must fit in memory (size it vs `maxmemory`; otherwise use cache-aside); CDC is eventually consistent, events can be lost (broker outage, consumer crash, config drift) so run periodic reconciliation against the primary; sustained miss on IDs that exist = sync pipeline incident (return 404 or page on-call; do NOT fall back to primary); keep one multiplexed node-redis client and monitor `error`. Debug: `redis-cli --scan --pattern 'cache:category:*'`, `HGETALL`, `TTL` (key missing = prefetch didn't run/expired without refresh; key present for deleted ID = delete event not yet applied).
- Contrast with cache-aside: cold-start misses and TTL-expiry refetch spikes vs. isolated primary load.

## https://redis.io/docs/latest/develop/use-cases/pub-sub  (+ /nodejs)
- Recommended approach: PUBLISH/SUBSCRIBE (exact channels) and PSUBSCRIBE (glob patterns) as a stateless live-broadcast transport; delivery AT-MOST-ONCE; pair with a durable store or Streams when you can't lose events.
- Commands: PUBLISH (returns number of subscribers it was delivered to right then; steady 0 = typo in channel), SUBSCRIBE/UNSUBSCRIBE, PSUBSCRIBE/PUNSUBSCRIBE, introspection `PUBSUB CHANNELS`, `PUBSUB NUMSUB`, `PUBSUB NUMPAT`, sharded SSUBSCRIBE/SPUBLISH (7.0+), keyspace notifications mentioned. No Redis keys are used (channels are routing entries); `scan`/`keys` show nothing.
- Node: helper `RedisPubSubHub`; each subscriber gets its own connection via `hubClient.duplicate()`; `client.subscribe(channel, (message, channel) => ...)`, `client.pSubscribe(pattern, listener)`; a subscribe-mode client throws on ordinary commands; messages JSON-encoded; node-redis 5.x auto reconnects and re-registers listeners but missed messages are gone. A message matching both an exact and a pattern subscription is delivered twice.
- Channel naming: colon hierarchy, e.g. `orders:new`, `notifications:billing:invoice`, `cache:invalidate:products:p-001`; subscribe patterns `notifications:*`, `cache:invalidate:*`, `orders:*` (patterns are evaluated per published message: avoid many).
- Use cases: cache invalidation broadcast, WebSocket fan-out across server nodes (Socket.IO Redis adapter pattern), presence/typing indicators, live dashboards, topic hierarchies.
- Trade-offs/warnings: offline subscriber loses messages permanently (write durable record then PUBLISH; reconcile from durable store on reconnect); don't do heavy sync work in the listener (hand off to a worker queue); bound any in-memory message buffer (demo caps at 50); on Cluster prefer sharded pub/sub because plain PUBLISH goes to every node via cluster bus; redis-cli in subscribe mode exits only with Ctrl-C.

## https://redis.io/docs/latest/develop/use-cases/streaming  (+ /nodejs)
- Recommended approach: Redis STREAM with CONSUMER GROUPS: producer `XADD key MAXLEN ~ n * ...`; consumers `XREADGROUP ... STREAMS key >` with BLOCK; `XACK` after processing; multiple independent groups on one stream; `XAUTOCLAIM` (self as target) to recover entries of crashed consumers; `XRANGE` for replay. At-least-once delivery.
- Key/data: stream `demo:events:orders`; entry fields `type`, `order_id`, `customer`, `amount`, `ts_ms`; IDs `{ms}-{seq}`. Helper `EventStream({redisClient, streamKey, maxlenApprox: 2000, claimMinIdleMs: 5000})` with `produce`, `ensureGroup(group, "0-0")`, `consume(group, consumer, count, blockMs)`, `ack`, `autoclaim`, `replay("-","+",n)`. Two demo groups `notifications` (workers worker-a/worker-b) and `analytics`; each group has own `last-delivered-id` and PEL; adding a worker doubles throughput with no rebalance logic.
- Subtleties stated: reading with an explicit id like `0-0` instead of `>` replays the consumer's own PEL (recovery after restart); new group on an old stream should usually start at `$` and use XRANGE for history; XADD MAXLEN ~/XTRIM can drop an entry's payload while its ID is still in the PEL: XAUTOCLAIM (Redis 7.0+) returns those IDs in `deletedMessages` and removes them from the PEL (no XACK needed) -> log and route to dead-letter store; `XCLAIM` for specific ids / consumer handover (XAUTOCLAIM can't filter by source consumer); delivery counter increments on every claim (poison-pill signal).
- Production guidance: retention by `MAXLEN ~` (default approximate), `XTRIM MINID ~ <ms>-0` for time-based retention (e.g. last 24 h), or no cap on XADD plus periodic XTRIM; exact trimming only if needed; alert on `XINFO GROUPS` `lag` and `pending` and on `XINFO CONSUMERS` idle/pending; make consumers idempotent (no exactly-once); after e.g. `deliveries >= 5` move to a dead-letter stream, XACK on original group; partition by tenant/entity (`events:orders:{tenant_a}`, per-entity `events:order:{order_id}` for event sourcing; hash tag keeps related streams on one shard) because a stream is one key = one shard; separate consumer pool per group; one Redis client per blocking `XREADGROUP`; don't use plain `XREAD` for at-least-once (no PEL, cannot ack) - fine for tail-only UIs.
- Variations/related: job queue (each task to exactly one worker, discarded) vs streaming (retained, replayable, many groups); pub/sub (at-most-once). Overview claims Redis can replace Kafka for moderate scale/short retention (vendor-docs claim).
- Redis 8.2+ stream extras (XACKDEL/XDELEX, KEEPREF/DELREF/ACKED) and 8.8 XNACK are NOT used in these guides (see data-types/streams section).
