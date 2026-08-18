import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Falešné prostředí pro testy – klíče jsou vygenerované, ale neplatné. */
process.env.VAPID_PUBLIC_KEY =
  'BPS6uSuDyUO-KuTrjKpCZ7SQAeliy0UcX2E7yO1DS2Z0n3vSjwBiUOgZPpfRHkV9Qrkv9rLSoK-p4NNwU4BLZVg'
process.env.VAPID_PRIVATE_KEY = 'fEHGWtbywMmEOoCwvrXXOBcgz12PbgkunlLqumJ_ifY'
process.env.VAPID_SUBJECT = 'mailto:test@example.com'
process.env.HENRY_TOKEN = 'testovaci-token'
process.env.TZ_NAME = 'Europe/Prague'
process.env.SCHEDULER = 'off'
// Do repozitáře se při testech nesmí nic zapsat – databáze jde do temp.
process.env.DATA_FILE = join(tmpdir(), `henry-test-${process.pid}.json`)
