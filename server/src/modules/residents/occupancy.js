'use strict';
/** One active household login per unit. A new resident can take a unit only after the previous one is marked as vacated. */
async function assertUnitVacant(unitId, exceptResidentId = null) {
  const prisma = require('../../config/prisma'); const H = require('../../utils/http');
  const cur = await prisma.resident.findFirst({ where: { unitId, isActive: true, ...(exceptResidentId ? { NOT: { id: exceptResidentId } } : {}) }, include: { user: { select: { name: true } } } });
  if (cur) throw H.conflict(`This unit is still occupied by ${cur.user?.name || 'another resident'}. Mark them as vacated first.`, 'UNIT_OCCUPIED');
}
module.exports = { assertUnitVacant };
