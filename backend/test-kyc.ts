import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("Searching for Arsène...");
    const targetUser = await prisma.user.findFirst({
        where: { name: { contains: "Ars" } }
    });

    if (!targetUser) {
        console.log("User not found!");
        return;
    }

    console.log("Found user:", targetUser.id, targetUser.name);

    // Try to update KYC
    try {
        const newLevel = 1;

        await (prisma.user as any).update({
            where: { id: targetUser.id },
            data: { kycStatus: 'APPROVED', kycLevel: newLevel }
        });

        console.log("KYC Updated perfectly!");

        // Try to audit log
        console.log("Creating Audit Log...");
        const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (admin) {
            await prisma.auditLog.create({
                data: {
                    adminId: admin.id,
                    action: `KYC_APPROVED`,
                    details: `KYC for ${targetUser.phone} set to APPROVED`
                }
            });
            console.log("Audit log created!");
        }

    } catch (e) {
        console.error("CRASH DURING KYC APPROVAL:");
        console.error(e);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
