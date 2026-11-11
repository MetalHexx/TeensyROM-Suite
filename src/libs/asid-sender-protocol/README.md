# asid-sender-protocol

What the DJ mixer's app page and the ASID sender page (`apps/asid-sender`) share, and nothing more. The
sender is a tiny hidden page on the app's other local name (`127.0.0.1` for an app on `localhost`, and
the reverse), so it gets a process and thread of its own. This library is the single source for:

- the message shapes between the two pages, and the sender's identity and protocol version
- the sender's path and address rule (`otherLocalName`, `pairedLocalOrigin`, `isAsidSenderPath`,
  `startUnlessSenderPath`)
- the shared-clock time conversion (`toSharedTime`, `fromSharedTime`)
- the TeensyROM port-name token (`teensyRomToken`)
- the steady tick cadence both sides run on (`SENDER_TICK_MS`)
- the shape of the timing report the sender hands the dev bench
- the 0.1 ms histogram both pages' timing readings use

## Why it is its own library

The sender page may import **only** this library from the workspace. ESLint enforces it: a project tagged
`scope:asid-sender` can depend only on libs tagged `asid-sender:protocol` (see `eslint.config.mjs`), so
the page never loads any of the app. The main app (application and infrastructure layers) imports it as
a shared utility.

`teensyRomToken` is a deliberate copy of `midiPortDeviceToken` in `libs/domain`, because the sender
cannot import `domain`. The two patterns must stay identical: `libs/infrastructure`'s
`sender-token-agreement.spec.ts` checks that they agree.

## Running unit tests

Run `nx test asid-sender-protocol` to execute the unit tests via [Vitest](https://vitest.dev/).
