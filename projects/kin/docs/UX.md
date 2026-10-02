# UX

**Status:** Today and Needs, fixed classification, fast capture, and item lifecycle actions are implemented. Handoff, Talk, Pulse, and Since You Last Looked sections remain conceptual.

## Primary question

The main experience should answer:

> What does our household need to know right now?

The home view should make useful context scannable and keep capture close at hand. Avoid turning household communication into administration.

## Current home hierarchy

The implemented view presents Today and Needs as separate sections, with active and completed items grouped within each. Archived items are omitted. This is the current structure, not a commitment to the other concepts shown below.

## Future home concepts

```text
KIN

Today
────────────────────
Pediatrician — 2:30 PM
Trash tonight

Needs
────────────────────
□ Buy milk
□ Restock wipes

Handoff
────────────────────
Benjamin ate at 12:15
Diaper bag needs wipes

From me
────────────────────
Need about 30 minutes to decompress tonight.
```

This is an example of possible content hierarchy, not a final visual design or implemented screen.

## Add something

Capture is short and forgiving. The current form accepts text and defaults classification to Needs; a native selector can place it in Today with one additional action:

```text
+ Add

What should we remember?

> buy milk

[ Needs ] [ Today ]
```

The target interaction is:

```text
tap
type a few words
tap
done
```

The two classifications are fixed. Do not add category management or require more metadata.

## Handoff

A handoff should transfer actionable context in a few short entries, rather than demand a formal report:

```text
Kid
✓ Ate
✓ Changed
! Need wipes

House
✓ Dishwasher running

FYI
Grandma called.
```

The receiver should be able to understand what matters without reconstructing a long message thread. Acknowledgement, if added, should confirm receipt rather than grade the sender or receiver.

## Talk

Talk is for capturing a topic that matters without forcing the conversation to happen immediately:

```text
Talk about:
Weekend plans
```

A future structured conversation might optionally ask “What do I need?”, “What am I willing to compromise on?”, or “What is a boundary?” This is secondary to everyday coordination and must not turn Kin into a relationship counselor or judge.

## Pulse

Pulse is a current, lightweight capacity signal. Possible labels include:

```text
Good
Okay
Drained
Rough
Need quiet
```

It is context, not a mood score, diagnosis, historical ranking, or prompt to infer intent. Any future signal should have a clear lifespan and a respectful way to change or clear it.

## Since You Last Looked

The eventual summary should show meaningful changes since a household member last checked:

```text
Since 8:14 AM

+ Milk added
✓ Electric bill handled
+ Dinner changed
! Weekend plans added to Talk
```

It should be compact and useful, derived from events, and should not become a surveillance feed or expose activity beyond what the household expects.

## Interaction constraints

- Keep routine capture short; allow more detail only when useful.
- Make status and responsibility legible without scoring people.
- Design for small screens, interruptions, and one-handed use.
- Make accessibility part of implementation, not a later polish pass.
- Prefer calm, neutral language; do not imply fault when something is incomplete.
