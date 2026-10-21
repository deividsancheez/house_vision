// Budget math for the current layout. All money is handled in integer cents so the
// designer's default layout reproduces exactly $1,018.17.
//   new (taxed) items: subtotal + tax at products.json tax_rate (9.75%), rounded half-up to the cent
//   used items (taxed = false): private sales, no tax
//   delivery: products.json budget.delivery (0 with pickup)

export const toCents = (dollars) => Math.round(dollars * 100);

export function lineCents(product) {
  return toCents(product.price) * (product.qty ?? 1);
}

/** layout.slots[slotId].option is a product id, or null when the item was removed. */
export function computeBudget(cat, layout) {
  const rateBp = Math.round((cat.taxRate ?? 0) * 10000); // basis points: 0.0975 -> 975
  const lines = [];
  let taxedCents = 0, untaxedCents = 0;
  for (const slot of cat.slots.values()) {
    const sel = layout.slots[slot.slot_id];
    const pid = sel ? sel.option : slot.default_option;
    if (!pid) continue;
    const p = cat.products.get(pid);
    if (!p) continue;
    const cents = lineCents(p);
    if (p.taxed) taxedCents += cents; else untaxedCents += cents;
    lines.push({ slotId: slot.slot_id, room: slot.room, productId: p.id, name: p.name, retailer: p.retailer, qty: p.qty ?? 1, unitCents: toCents(p.price), cents, taxed: !!p.taxed, condition: p.condition });
  }
  // Products added from the Catalog on top of the slots' own picks count the same way.
  // (Stored pieces stay in the budget: they are bought, only not placed.)
  for (const x of layout.extras || []) {
    const p = cat.products.get(x.product);
    if (!p) continue;
    const slot = cat.slots.get(p.slot);
    const cents = lineCents(p);
    if (p.taxed) taxedCents += cents; else untaxedCents += cents;
    lines.push({ slotId: p.slot, extra: x.uid, room: slot?.room, productId: p.id, name: p.name, retailer: p.retailer, qty: p.qty ?? 1, unitCents: toCents(p.price), cents, taxed: !!p.taxed, condition: p.condition });
  }
  // Lookbook pieces placed freely count the same way (only while they are in the layout).
  for (const x of layout.lookbook || []) {
    const p = cat.products.get(x.product);
    if (!p) continue;
    const cents = lineCents(p);
    if (p.taxed) taxedCents += cents; else untaxedCents += cents;
    lines.push({ slotId: null, lookbook: x.uid, room: x.room, productId: p.id, name: p.name, retailer: p.retailer, qty: p.qty ?? 1, unitCents: toCents(p.price), cents, taxed: !!p.taxed, condition: p.condition });
  }
  // A delivery fee listed on a lookbook product (the World Market rug's oversized shipping) is added once per line.
  let lookbookDelivery = 0;
  for (const l of lines) {
    const fee = cat.products.get(l.productId)?.lookbook?.deliveryFee;
    if (fee) { l.deliveryCents = toCents(fee); lookbookDelivery += l.deliveryCents; }
  }
  const taxCents = Math.floor((taxedCents * rateBp + 5000) / 10000);
  const deliveryCents = toCents(cat.budgetMeta?.delivery ?? 0) + lookbookDelivery;
  const totalCents = taxedCents + untaxedCents + taxCents + deliveryCents;
  const capCents = toCents(cat.budgetMeta?.budget_cap ?? 0);
  return {
    lines,
    taxedCents,
    untaxedCents,
    taxCents,
    deliveryCents,
    totalCents,
    capCents,
    remainingCents: capCents - totalCents,
    over: totalCents > capCents,
    taxRate: rateBp / 10000,
  };
}

export function fmtMoney(cents) {
  const neg = cents < 0;
  const v = Math.abs(cents);
  const s = `$${Math.floor(v / 100).toLocaleString('en-US')}.${String(v % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}
