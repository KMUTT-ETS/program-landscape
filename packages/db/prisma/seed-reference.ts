import { PrismaClient } from '@prisma/client';
import { seedReference } from '../src/seed-reference';

const prisma = new PrismaClient();

seedReference(prisma)
  .then((r) => {
    // eslint-disable-next-line no-console
    console.log('seed-reference:', JSON.stringify(r));
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
