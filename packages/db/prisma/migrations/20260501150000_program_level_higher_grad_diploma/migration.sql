-- Adds HIGHER_GRAD_DIPLOMA to ProgramLevel — covers ประกาศนียบัตรบัณฑิตชั้นสูง
-- (post-master's certificate / specialty boards). Driven by the KKU master
-- programs sheet, which lists 11 such programs across 4 faculties.

ALTER TYPE "ProgramLevel" ADD VALUE IF NOT EXISTS 'HIGHER_GRAD_DIPLOMA';
