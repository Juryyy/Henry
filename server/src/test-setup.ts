/** Falešné prostředí pro testy – klíče jsou vygenerované, ale neplatné. */
process.env.VAPID_PUBLIC_KEY =
  'BPS6uSuDyUO-KuTrjKpCZ7SQAeliy0UcX2E7yO1DS2Z0n3vSjwBiUOgZPpfRHkV9Qrkv9rLSoK-p4NNwU4BLZVg'
process.env.VAPID_PRIVATE_KEY = 'fEHGWtbywMmEOoCwvrXXOBcgz12PbgkunlLqumJ_ifY'
process.env.VAPID_SUBJECT = 'mailto:test@example.com'
process.env.TZ_NAME = 'Europe/Prague'
process.env.SCHEDULER = 'off'
// Databáze jede v testech v paměti – do repozitáře se nic nezapíše.
process.env.DB_FILE = ':memory:'
// Cookie bez HTTPS by v testech neprošla.
process.env.SECURE_COOKIES = 'off'
// Appku v testech neservírujeme – zajímá nás API.
process.env.APP_DIR = ''
