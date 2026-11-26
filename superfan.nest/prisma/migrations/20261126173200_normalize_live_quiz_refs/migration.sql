-- Normalize legacy live_quiz_reward:..., live_quiz_consolation:..., live_quiz_winner:... references to LIVEQUIZ-REW-..., LIVEQUIZ-CON-..., LIVEQUIZ-WIN-...
UPDATE "WalletTransaction"
SET "trx_ref" = REPLACE(REPLACE("trx_ref", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "trx_ref" LIKE 'live_quiz_reward:%';

UPDATE "WalletTransaction"
SET "trx_ref" = REPLACE(REPLACE("trx_ref", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "trx_ref" LIKE 'live_quiz_consolation:%';

UPDATE "WalletTransaction"
SET "trx_ref" = REPLACE(REPLACE("trx_ref", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "trx_ref" LIKE 'live_quiz_winner:%';

UPDATE "WalletTransaction"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_reward:%';

UPDATE "WalletTransaction"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_consolation:%';

UPDATE "WalletTransaction"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_winner:%';

UPDATE "LedgerJournalLine"
SET "trxRef" = REPLACE(REPLACE("trxRef", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "trxRef" LIKE 'live_quiz_reward:%';

UPDATE "LedgerJournalLine"
SET "trxRef" = REPLACE(REPLACE("trxRef", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "trxRef" LIKE 'live_quiz_consolation:%';

UPDATE "LedgerJournalLine"
SET "trxRef" = REPLACE(REPLACE("trxRef", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "trxRef" LIKE 'live_quiz_winner:%';

UPDATE "Reward"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_reward:%';

UPDATE "Reward"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_consolation:%';

UPDATE "Reward"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_winner:%';

UPDATE "Point"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_reward:%';

UPDATE "Point"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_consolation:%';

UPDATE "Point"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_winner:%';

UPDATE "ActivityWallet"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_reward:', 'LIVEQUIZ-REW-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_reward:%';

UPDATE "ActivityWallet"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_consolation:', 'LIVEQUIZ-CON-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_consolation:%';

UPDATE "ActivityWallet"
SET "reference" = REPLACE(REPLACE("reference", 'live_quiz_winner:', 'LIVEQUIZ-WIN-'), ':', '-')
WHERE "reference" LIKE 'live_quiz_winner:%';
