/// AuditAnchor — per-entity, append-only, tamper-evident hash chain for
/// enterprise accounting audit snapshots.
///
/// Design (architecture spec §4):
/// - `EntityAnchorChain` is a *shared* object of constant size: it only ever
///   holds the latest link of the chain, never the history (history lives in
///   emitted events). This bounds on-chain storage regardless of period count.
/// - Write authority is carried by an owned `AnchorCap`, NOT by `ctx.sender()`,
///   so a sponsored transaction cannot let a third party forge an anchor.
/// - Each `anchor_snapshot` folds the previous link into a new sha2-256 link,
///   making any gap or tampering detectable by an auditor who re-computes the
///   chain off-chain. Journal-entry detail never touches the chain — only the
///   32-byte `manifest_hash` and `merkle_root` do, preserving privacy while
///   still enabling per-JE inclusion proofs against `merkle_root`.
module audit_anchor::audit_anchor;

use sui::event;
use sui::bcs;
use std::hash;

/// Module version (PAT-VM-1). Bump on every incompatible package upgrade;
/// state-modifying functions reject objects whose `version` differs, so a
/// stale package version can never write mixed-version state after an upgrade.
const VERSION: u64 = 1;
/// Fixed length (bytes) of every hash field on the chain.
const HASH_LEN: u64 = 32;
/// Maximum length (bytes) of opaque off-chain identifiers carried on-chain.
const MAX_REF_LEN: u64 = 64;
/// Genesis link: 32 zero bytes.
const GENESIS_LINK: vector<u8> =
    x"0000000000000000000000000000000000000000000000000000000000000000";

#[error]
const EWrongChain: vector<u8> = b"AnchorCap is not bound to this chain";
#[error]
const EStaleCap: vector<u8> = b"AnchorCap epoch is stale; cap was rotated";
#[error]
const EBadHashLen: vector<u8> = b"manifest_hash / merkle_root must be exactly 32 bytes";
#[error]
const ERefTooLong: vector<u8> = b"entity_ref / period_id exceeds 64 bytes";
#[error]
const ELinkMismatch: vector<u8> = b"prev_link does not match chain.latest_link (append-only violation)";
#[error]
const EWrongVersion: vector<u8> = b"chain.version does not match this package VERSION; run migrate first";
#[error]
const ENotOlderVersion: vector<u8> = b"chain.version is not older than this package VERSION; nothing to migrate";

/// Per-entity chain head. Shared; constant size.
public struct EntityAnchorChain has key {
    id: UID,
    /// PAT-VM-1: object version; writes assert `version == VERSION`.
    version: u64,
    /// Opaque off-chain entity id (≤ 64 bytes).
    entity_ref: vector<u8>,
    /// Latest chain link (32 bytes); genesis = [0u8; 32].
    latest_link: vector<u8>,
    /// Monotonic anchor counter; the canonical ordering for reconciliation.
    seq: u64,
    /// F1: bumping this invalidates every previously issued AnchorCap.
    cap_epoch: u64,
    /// period_id of the most recent anchor (informational).
    last_period: vector<u8>,
}

/// Write capability for exactly one chain. Owned, transferable for rotation.
public struct AnchorCap has key, store {
    id: UID,
    chain_id: ID,
    /// F1: must equal `chain.cap_epoch` at write time.
    epoch: u64,
}

/// Emitted on every successful anchor. The auditor/indexer's primary record.
/// F3: a period may be anchored multiple times (restatement); `seq` is the
/// true order and `supersedes_seq` points at the version this one replaces.
public struct SnapshotAnchored has copy, drop {
    chain_id: ID,
    seq: u64,
    period_id: vector<u8>,
    manifest_hash: vector<u8>,
    merkle_root: vector<u8>,
    link: vector<u8>,
    supersedes_seq: u64,
}

/// Emitted when a cap is rotated (epoch bumped, new cap minted).
public struct CapRotated has copy, drop {
    chain_id: ID,
    new_epoch: u64,
    new_owner: address,
}

/// Emitted on chain creation so indexers can discover chains and resolve
/// entity_ref → chain_id from the event stream alone (S3 fix: previously the
/// binding existed only in object state).
public struct ChainCreated has copy, drop {
    chain_id: ID,
    entity_ref: vector<u8>,
    creator: address,
}

/// Emitted when a chain object is migrated to the current package VERSION.
public struct ChainMigrated has copy, drop {
    chain_id: ID,
    old_version: u64,
    new_version: u64,
}

/// Create a new per-entity chain. Shares the chain and hands the genesis
/// AnchorCap (epoch 0) to the caller.
#[allow(lint(self_transfer))]
public fun create_chain(entity_ref: vector<u8>, ctx: &mut TxContext) {
    assert!(entity_ref.length() <= MAX_REF_LEN, ERefTooLong);

    let chain = EntityAnchorChain {
        id: object::new(ctx),
        version: VERSION,
        entity_ref,
        latest_link: GENESIS_LINK,
        seq: 0,
        cap_epoch: 0,
        last_period: vector[],
    };
    let cap = AnchorCap {
        id: object::new(ctx),
        chain_id: object::id(&chain),
        epoch: 0,
    };
    event::emit(ChainCreated {
        chain_id: object::id(&chain),
        entity_ref: chain.entity_ref,
        creator: ctx.sender(),
    });
    transfer::transfer(cap, ctx.sender());
    transfer::share_object(chain);
}

/// Append one audit snapshot to the chain.
///
/// Aborts unless: the cap is bound to this chain (`EWrongChain`), the cap is
/// current (`EStaleCap`, F1), both hashes are 32 bytes and `period_id` ≤ 64
/// (`EBadHashLen` / `ERefTooLong`, F2), and `prev_link` matches the current
/// head (`ELinkMismatch`). `seq` overflow aborts by default (F5).
public fun anchor_snapshot(
    chain: &mut EntityAnchorChain,
    cap: &AnchorCap,
    manifest_hash: vector<u8>,
    merkle_root: vector<u8>,
    period_id: vector<u8>,
    prev_link: vector<u8>,
    supersedes_seq: u64,
) {
    // PAT-VM-1: refuse writes from a package whose VERSION doesn't match the object.
    assert!(chain.version == VERSION, EWrongVersion);

    // Authorization: bound cap + current epoch (F1).
    assert!(cap.chain_id == object::id(chain), EWrongChain);
    assert!(cap.epoch == chain.cap_epoch, EStaleCap);

    // F2: fixed-length assertions guard against storage-bloat / malformed data.
    assert!(manifest_hash.length() == HASH_LEN, EBadHashLen);
    assert!(merkle_root.length() == HASH_LEN, EBadHashLen);
    assert!(period_id.length() <= MAX_REF_LEN, ERefTooLong);

    // Append-only / tamper-evident: caller must echo the current head.
    assert!(prev_link == chain.latest_link, ELinkMismatch);

    // F5: default checked arithmetic — overflow aborts.
    let seq = chain.seq + 1;

    // link = sha2_256(prev_link || manifest_hash || merkle_root || period_id || bcs(seq))
    let mut preimage = prev_link;
    preimage.append(manifest_hash);
    preimage.append(merkle_root);
    preimage.append(period_id);
    preimage.append(bcs::to_bytes(&seq));
    let link = hash::sha2_256(preimage);

    chain.latest_link = link;
    chain.seq = seq;
    chain.last_period = period_id;

    event::emit(SnapshotAnchored {
        chain_id: object::id(chain),
        seq,
        period_id,
        manifest_hash,
        merkle_root,
        link,
        supersedes_seq,
    });
}

/// F1: rotate the write capability. Consumes the current cap, bumps the
/// chain's epoch (invalidating all outstanding caps), and mints a fresh cap
/// to `new_owner`.
public fun rotate_cap(
    chain: &mut EntityAnchorChain,
    old_cap: AnchorCap,
    new_owner: address,
    ctx: &mut TxContext,
) {
    // PAT-VM-1: same version gate as anchor_snapshot.
    assert!(chain.version == VERSION, EWrongVersion);

    assert!(old_cap.chain_id == object::id(chain), EWrongChain);
    assert!(old_cap.epoch == chain.cap_epoch, EStaleCap);

    let AnchorCap { id, chain_id: _, epoch: _ } = old_cap;
    id.delete();

    chain.cap_epoch = chain.cap_epoch + 1;

    let new_cap = AnchorCap {
        id: object::new(ctx),
        chain_id: object::id(chain),
        epoch: chain.cap_epoch,
    };
    transfer::transfer(new_cap, new_owner);

    event::emit(CapRotated {
        chain_id: object::id(chain),
        new_epoch: chain.cap_epoch,
        new_owner,
    });
}

/// PAT-VM-1: migrate a chain object created by an older package version to the
/// current VERSION. Gated by the chain's own current AnchorCap — the module's
/// single write authority — rather than a package-wide AdminCap, so no new
/// trust root is introduced and only the entity's cap holder can migrate.
public fun migrate(chain: &mut EntityAnchorChain, cap: &AnchorCap) {
    assert!(cap.chain_id == object::id(chain), EWrongChain);
    assert!(cap.epoch == chain.cap_epoch, EStaleCap);
    assert!(chain.version < VERSION, ENotOlderVersion);

    let old_version = chain.version;
    chain.version = VERSION;

    event::emit(ChainMigrated {
        chain_id: object::id(chain),
        old_version,
        new_version: VERSION,
    });
}

// === Read-only accessors (for tests / off-chain) ===

public fun version(chain: &EntityAnchorChain): u64 { chain.version }
public fun latest_link(chain: &EntityAnchorChain): vector<u8> { chain.latest_link }
public fun seq(chain: &EntityAnchorChain): u64 { chain.seq }
public fun cap_epoch(chain: &EntityAnchorChain): u64 { chain.cap_epoch }
public fun entity_ref(chain: &EntityAnchorChain): vector<u8> { chain.entity_ref }
public fun cap_epoch_of(cap: &AnchorCap): u64 { cap.epoch }
public fun genesis_link(): vector<u8> { GENESIS_LINK }

// === Tests ===
// Kept in-module so #[expected_failure] can reference private error
// constants and tests can read struct internals directly.

#[test_only]
use sui::test_scenario as ts;

#[test_only]
const ADMIN: address = @0xA;
#[test_only]
const NEW_OWNER: address = @0xB;

#[test_only]
/// A valid 32-byte hash with the low byte set to `tag` (so callers can make
/// distinct-but-valid hashes).
fun h32(tag: u8): vector<u8> {
    let mut v = x"0000000000000000000000000000000000000000000000000000000000000000";
    *(&mut v[31]) = tag;
    v
}

#[test_only]
/// Force the chain's cap_epoch ahead without consuming the cap — manufactures
/// the (otherwise consumption-protected) stale-cap condition for F1 testing.
public fun bump_epoch_for_test(chain: &mut EntityAnchorChain) {
    chain.cap_epoch = chain.cap_epoch + 1;
}

#[test_only]
/// Simulate an object created by an older package version (create_chain always
/// stamps the current VERSION, so tests need a back-door to age an object).
public fun set_version_for_test(chain: &mut EntityAnchorChain, v: u64) {
    chain.version = v;
}

#[test]
fun test_happy_path_chains_links() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());

    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    assert!(seq(&chain) == 0, 0);
    assert!(latest_link(&chain) == genesis_link(), 1);

    // First anchor off the genesis link.
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);
    assert!(seq(&chain) == 1, 2);
    let link1 = latest_link(&chain);
    assert!(link1 != genesis_link(), 3);

    // Second anchor must echo the *new* head; links must differ.
    anchor_snapshot(&mut chain, &cap, h32(3), h32(4), b"2026-Q2", link1, 1);
    assert!(seq(&chain) == 2, 4);
    assert!(latest_link(&chain) != link1, 5);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = ELinkMismatch)]
fun test_append_only_rejects_wrong_prev_link() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // prev_link != genesis → abort (gap / tamper attempt).
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", h32(9), 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EBadHashLen)]
fun test_f2_rejects_short_manifest_hash() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // 4-byte manifest_hash → F2 abort.
    anchor_snapshot(&mut chain, &cap, x"deadbeef", h32(2), b"2026-Q1", genesis_link(), 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = ERefTooLong)]
fun test_f2_rejects_overlong_period_id() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // 65-byte period_id (> MAX_REF_LEN) → abort.
    let mut period = vector[];
    65u64.do!(|_| period.push_back(7u8));
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), period, genesis_link(), 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EStaleCap)]
fun test_f1_stale_cap_rejected() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // Chain epoch advances; the held cap (epoch 0) is now stale.
    bump_epoch_for_test(&mut chain);
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongChain)]
fun test_cap_bound_to_one_chain() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-A", sc.ctx());
    sc.next_tx(ADMIN);
    create_chain(b"entity-B", sc.ctx());
    sc.next_tx(ADMIN);

    // Two chains, two caps now exist; take the most-recent shared chain (B)
    // and an arbitrary cap, then prove a cap can't drive a foreign chain.
    let ids = ts::ids_for_sender<AnchorCap>(&sc);
    let cap_a = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(0));
    let cap_b = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(1));
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);

    // One of the two caps is foreign to `chain`; pick the one whose chain_id
    // differs so the EWrongChain branch is exercised deterministically.
    let a_is_owner = cap_a.chain_id == object::id(&chain);
    let (foreign, owned) = if (a_is_owner) (cap_b, cap_a) else (cap_a, cap_b);

    anchor_snapshot(&mut chain, &foreign, h32(1), h32(2), b"P", genesis_link(), 0);

    ts::return_to_sender(&sc, foreign);
    ts::return_to_sender(&sc, owned);
    ts::return_shared(chain);
    sc.end();
}

#[test]
fun test_rotate_cap_mints_fresh_and_invalidates_epoch() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);
    let old_cap = sc.take_from_sender<AnchorCap>();
    assert!(cap_epoch(&chain) == 0, 0);

    // Rotate: old cap consumed, epoch bumped, new cap to NEW_OWNER.
    rotate_cap(&mut chain, old_cap, NEW_OWNER, sc.ctx());
    assert!(cap_epoch(&chain) == 1, 1);

    // New owner's cap is epoch 1 and can anchor.
    sc.next_tx(NEW_OWNER);
    let new_cap = sc.take_from_sender<AnchorCap>();
    assert!(cap_epoch_of(&new_cap) == 1, 2);
    anchor_snapshot(&mut chain, &new_cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);
    assert!(seq(&chain) == 1, 3);

    ts::return_to_sender(&sc, new_cap);
    ts::return_shared(chain);
    sc.end();
}

#[test]
/// Known-answer test (TST-CV-1): pins the exact preimage layout
/// prev_link || manifest_hash || merkle_root || period_id || bcs(seq).
/// Expected digest computed independently (python hashlib) for
/// prev=32x00, manifest=h32(1), merkle=h32(2), period="2026-Q1", seq=1.
/// Any reordering or dropped component of the preimage fails this test —
/// the `link != prev` assertions elsewhere cannot catch that.
fun test_known_answer_link_derivation() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);
    let expected = x"613b233b56499430f4871741504ec4a8a7b2a378609f1481041ff62d02451725";
    assert!(latest_link(&chain) == expected, 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongVersion)]
/// PAT-VM-1: a chain stamped with an older version must reject writes until migrated.
fun test_version_gate_rejects_old_object() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    set_version_for_test(&mut chain, 0);
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test]
/// PAT-VM-1: migrate lifts an old object to VERSION, after which writes succeed.
fun test_migrate_then_anchor_succeeds() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    set_version_for_test(&mut chain, 0);
    migrate(&mut chain, &cap);
    assert!(version(&chain) == 1, 0);
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"2026-Q1", genesis_link(), 0);
    assert!(seq(&chain) == 1, 1);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    // ChainMigrated + SnapshotAnchored must both have been emitted in this tx.
    let effects = sc.next_tx(ADMIN);
    assert!(ts::num_user_events(&effects) == 2, 2);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongVersion)]
/// rotate_cap carries the same version gate as anchor_snapshot — deleting
/// either assert must fail a test.
fun test_version_gate_rejects_old_object_on_rotate() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    set_version_for_test(&mut chain, 0);
    rotate_cap(&mut chain, cap, NEW_OWNER, sc.ctx());

    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongChain)]
/// migrate must reject a cap bound to a different chain (same guard as
/// anchor_snapshot / rotate_cap; previously only the epoch branch was tested).
fun test_migrate_rejects_foreign_cap() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-A", sc.ctx());
    sc.next_tx(ADMIN);
    create_chain(b"entity-B", sc.ctx());
    sc.next_tx(ADMIN);

    let ids = ts::ids_for_sender<AnchorCap>(&sc);
    let cap_a = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(0));
    let cap_b = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(1));
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);

    let a_is_owner = cap_a.chain_id == object::id(&chain);
    let (foreign, owned) = if (a_is_owner) (cap_b, cap_a) else (cap_a, cap_b);

    set_version_for_test(&mut chain, 0);
    migrate(&mut chain, &foreign);

    ts::return_to_sender(&sc, foreign);
    ts::return_to_sender(&sc, owned);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = ENotOlderVersion)]
/// migrate on a current-version chain is a no-op refused loudly.
fun test_migrate_rejects_current_version() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    migrate(&mut chain, &cap);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EStaleCap)]
/// migrate carries the same cap authorization as every other write.
fun test_migrate_rejects_stale_cap() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    set_version_for_test(&mut chain, 0);
    bump_epoch_for_test(&mut chain);
    migrate(&mut chain, &cap);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test]
/// S3: create_chain emits ChainCreated so indexers can discover chains from
/// the event stream alone (previously the binding lived only in object state).
fun test_create_chain_emits_event() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    let effects = sc.next_tx(ADMIN);
    assert!(ts::num_user_events(&effects) == 1, 0);
    sc.end();
}

// === Monkey / boundary tests ===

#[test]
/// Stress: 100 chained anchors. seq stays monotonic and every link is fresh.
fun test_monkey_100_anchors_chain() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);
    let cap = sc.take_from_sender<AnchorCap>();

    let mut prev = genesis_link();
    let mut i = 0u8;
    100u64.do!(|_| {
        let prev_link = latest_link(&chain);
        anchor_snapshot(&mut chain, &cap, h32(i), h32(i), b"P", prev_link, 0);
        let now = latest_link(&chain);
        assert!(now != prev, 100); // collision/no-op would be a tamper hole
        prev = now;
        i = i + 1;
    });
    assert!(seq(&chain) == 100, 101);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test]
/// Boundary: period_id of exactly MAX_REF_LEN (64) bytes is accepted; F3
/// restatement — the same period anchored twice with supersedes_seq set.
fun test_boundary_max_period_and_restatement() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);
    let cap = sc.take_from_sender<AnchorCap>();

    let mut period = vector[];
    64u64.do!(|_| period.push_back(7u8)); // exactly at the limit → ok
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), period, genesis_link(), 0);
    assert!(seq(&chain) == 1, 0);

    // Restate the same period (F3): seq advances to 2, supersedes_seq = 1.
    let link1 = latest_link(&chain);
    anchor_snapshot(&mut chain, &cap, h32(3), h32(4), period, link1, 1);
    assert!(seq(&chain) == 2, 1);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

// === Red-team tests (implementation layer) ===
// Supplement the F1–F5 design tests above with attack vectors that were not
// previously exercised. See move-notes.md red-team section for the threat model.

#[test, expected_failure(abort_code = ELinkMismatch)]
/// Ordering/race: two writers each read the same head L0, then writer-A commits
/// first (head → L1). Writer-B, still holding the now-stale prev_link L0, must
/// abort. This proves the append-only `prev_link == latest_link` check is the
/// concurrency guard for the shared chain — Sui consensus serializes the two
/// shared-object writes, and the second one can no longer match the head.
fun test_red_concurrent_writer_loses_on_stale_prev_link() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // Both writers observed the genesis head.
    let head_seen_by_both = latest_link(&chain);

    // Writer-A commits first; head advances.
    anchor_snapshot(&mut chain, &cap, h32(1), h32(2), b"P", head_seen_by_both, 0);

    // Writer-B replays its stale view of the head → ELinkMismatch.
    anchor_snapshot(&mut chain, &cap, h32(3), h32(4), b"P", head_seen_by_both, 0);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}

#[test, expected_failure(abort_code = EWrongChain)]
/// Object manipulation: a cap bound to chain-A cannot rotate chain-B. The
/// existing suite only checks the wrong-chain branch on `anchor_snapshot`;
/// `rotate_cap` carries the same `chain_id` assertion and must reject a foreign
/// cap too (otherwise an attacker could bump a victim chain's epoch and brick
/// every outstanding legitimate cap).
fun test_red_rotate_rejects_foreign_cap() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-A", sc.ctx());
    sc.next_tx(ADMIN);
    create_chain(b"entity-B", sc.ctx());
    sc.next_tx(ADMIN);

    let ids = ts::ids_for_sender<AnchorCap>(&sc);
    let cap_a = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(0));
    let cap_b = ts::take_from_sender_by_id<AnchorCap>(&sc, *ids.borrow(1));
    let mut chain = ts::take_shared<EntityAnchorChain>(&sc);

    let a_is_owner = cap_a.chain_id == object::id(&chain);
    let (foreign, owned) = if (a_is_owner) (cap_b, cap_a) else (cap_a, cap_b);

    // rotate_cap consumes the cap by value; feed it the foreign one → abort.
    rotate_cap(&mut chain, foreign, NEW_OWNER, sc.ctx());

    ts::return_to_sender(&sc, owned); // unreachable; satisfies type checker
    ts::return_shared(chain);
    sc.end();
}

#[test]
/// Input fuzz: `supersedes_seq` is purely informational — it is emitted, never
/// read by on-chain logic. Confirm an arbitrary MAX_U64 value is accepted and
/// does not corrupt `seq` or the link chain. Also confirms equal manifest/merkle
/// hashes and all-zero (non-genesis) hashes are accepted: validity is length,
/// not content. Off-chain consumers MUST treat supersedes_seq as untrusted.
fun test_red_supersedes_seq_is_inert_metadata() {
    let mut sc = ts::begin(ADMIN);
    create_chain(b"entity-1", sc.ctx());
    sc.next_tx(ADMIN);
    let mut chain = sc.take_shared<EntityAnchorChain>();
    let cap = sc.take_from_sender<AnchorCap>();

    // Garbage supersedes_seq pointing past any real seq; identical hashes.
    let max_u64 = 18446744073709551615u64;
    anchor_snapshot(&mut chain, &cap, h32(5), h32(5), b"P", genesis_link(), max_u64);
    assert!(seq(&chain) == 1, 0); // seq driven by chain state, not by the arg

    // All-zero hashes (= genesis_link bytes) are valid input; only length matters.
    let link1 = latest_link(&chain);
    anchor_snapshot(&mut chain, &cap, genesis_link(), genesis_link(), b"P", link1, 0);
    assert!(seq(&chain) == 2, 1);
    assert!(latest_link(&chain) != link1, 2);

    ts::return_to_sender(&sc, cap);
    ts::return_shared(chain);
    sc.end();
}
