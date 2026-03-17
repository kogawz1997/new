# Native Proof Environment Coverage

Generated: `2026-03-17T14:01:54.922Z`

## Current Verified Environment

- id: `workstation-local-agent-2026-03-17`
- label: Current workstation / local dedicated server
- workstation: Windows workstation with live SCUM client window
- server profile: Current local dedicated server configuration on this machine
- execution mode: `agent`
- tenant topology mode: `schema-per-tenant`
- proof sources: SCUM.db, SCUM.log
- notes: This is evidence for the current workstation only. It is not evidence of environment-independent native proof.

## Delivery Class Coverage

| Delivery class            | Proved on current environment | Strategy          | Cases                                             |
| ------------------------- | ----------------------------- | ----------------- | ------------------------------------------------- |
| ammo                      | yes                           | world-spawn-delta | ammo-ammobox-762                                  |
| consumable                | yes                           | world-spawn-delta | consumable-water                                  |
| food                      | yes                           | world-spawn-delta | food-bakedbeans                                   |
| gear                      | yes                           | world-spawn-delta | gear-backpack                                     |
| magazine                  | yes                           | world-spawn-delta | magazine-m1911                                    |
| medical                   | yes                           | world-spawn-delta | medical-bandage                                   |
| teleport wrapper profiles | yes                           | world-spawn-delta | teleport-wrapper-m1911, announce-teleport-bandage |
| weapon                    | yes                           | world-spawn-delta | weapon-m1911, weapon-ak47                         |

## Wrapper Profile Coverage

| Label                     | Delivery profile        | Proved | Strategy          |
| ------------------------- | ----------------------- | ------ | ----------------- |
| announce-teleport-bandage | announce_teleport_spawn | yes    | world-spawn-delta |
| teleport-wrapper-m1911    | teleport_spawn          | yes    | world-spawn-delta |

## Additional Captured Environments

- Current workstation / alternate SCUM server configuration [partial]: Second server configuration sample captured on the current workstation.; This configuration is sampled, but coverage is partial: magazine, ammo, and announce_teleport_spawn proved; water and base weapon still timed out here.
- Current workstation / RCON runtime attempt [blocked]: Capture the representative native-proof matrix through the RCON runtime path.; Blocked on this workstation: live RCON command attempt returned connect ECONNREFUSED 127.0.0.1:27015, so no second runtime matrix was captured.

## Experimental Cases

- `ammo-762` (ammo): Repeated 2026-03-17 live attempts timed out without a confirmed SCUM.db delta. Representative ammo proof now passes on this workstation with Cal_7_62x39mm_Ammobox, but loose-round IDs Ammo_762 and Cal_7_62x39mm still remain unproved here.

## Remaining Environment Coverage

- Additional SCUM server configuration: Capture the representative native-proof matrix on a server with a different SCUM patch/config/runtime profile than the two sampled configurations already recorded here.; Still needed before claiming broader environment coverage across server configurations.
- Additional workstation/runtime: Capture the representative native-proof matrix on another workstation or Windows session/runtime.; Needed before claiming native proof is reproduced beyond this workstation.
