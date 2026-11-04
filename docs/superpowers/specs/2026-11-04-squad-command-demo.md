# Squad and command: demo design

Status: approved by Rémi on 2026-11-04 ("go ahead"). This is a demo for a chief of police, labelled "Demo, not for real operations" until the security work is done.

## Why

A chief of police wants this: officers grouped in a squad, command seeing everyone on duty at all times, and, when something happens and a K9 team goes trailing, the trailing team's live position and trail shared with every officer, so they can close a perimeter and come in from other angles.

## Decisions (Rémi)

- **Goal:** a demo for the chief, not a live deployment yet.
- **His department has no team map system,** so Trailcraft is the team map (no TAK integration in the demo).
- **Location is shared only while a member's On duty switch is on.**
- **The command view works on a computer or big screen, and on a tablet or phone.**

## The demo

1. **Squad.** A chief creates a squad and gets a join code and QR code. Members join with it and pick a role (K9 handler with their dog, or officer) and a unit or call sign. The creator is Command and can promote others to Command, or remove members.
2. **On duty.** Each member has an On duty switch. While it is on, their position is shared with the squad every few seconds. In the iPhone app this keeps going in the background; on the website it runs only while the page is open. Off duty, nothing is shared, and the last position is cleared from the squad.
3. **Command view.** A command screen for the computer, big screen, tablet or phone. It shows every on-duty member on the map with name, call sign, role, heading and freshness; a position quiet for 2 minutes turns grey. It also lists members and lets command fit the map to all of them.
4. **Incident.** Command starts an incident: name, last known point dropped on the map, and the K9 team that will trail.
   - Every member's app shows a banner and opens the incident map.
   - The K9 team's live trail and marks (indication, lost it, re-found) are shown to all, with direction of travel and time since start.
   - Command and officers draw perimeter lines and drop points (sighting, roadblock, rally point); everyone sees them.
   - Ending the incident saves it for the debrief, with a replay of everyone's movements.
5. **Simulate officers.** A demo helper fills the map with pretend officers moving about and a pretend K9 trail, entirely on this device with no account and no cloud, so the chief can see the whole flow without real people.

## Requirements

- **Members only.** Squad data is readable and writable only by the squad's members (Firestore rules), with roles enforced in the rules. A join code is needed to join. Positions and incidents expire by TTL. The rules are written in the repository and published only with Rémi's OK.
- **Cost.** It must stay within Firebase's free daily limits for a demo of a few people over an hour or two: throttle position writes and write only on meaningful movement or every 10–15 s.
- **Unchanged.** Everything that exists keeps working: solo use, runs, live share, team levels and the audit fixes. The CSP stays intact.

## Out of scope (later, if the chief wants a pilot)

Push notifications with the app closed, radio or dispatch integration, police data-standard compliance (for example CJIS), single sign-on, Trailcraft's own web address and the remaining audit items, and a paid Firebase plan.
