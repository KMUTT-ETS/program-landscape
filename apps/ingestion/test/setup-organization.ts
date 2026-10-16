// Every existing suite was written against KKU's identity (prompt text,
// TCAS "own institution" rows). Load it as the test default; suites that
// test the cache itself reset it with setOrganizationForTest(undefined).
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';

setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
