// Pagination: pours blocks into fixed-size pages, measuring as it goes, so nothing on a page is ever
// cut off. A block that doesn't fit starts the next page; a heading marked keep-with-next moves along
// with the block after it; a block marked break-before always starts a page.
//
//   blocks:  elements; el.dataset.keep = 'next' | el.dataset.break = 'before' | el.dataset.optional
//            (an optional block that doesn't fit where it falls is left out instead of starting a page)
//   newPage: (n) => {el, body}   a fresh page (n = 0, 1... within this flow), already in the document
//                                 (the measuring area), whose body has a fixed height
//   head:    (n) => element|null optional, put at the top of each page of the flow (column labels,
//                                 "Options 1-3 of 7"...); filled in later, so it must keep its height

export function paginate(blocks, newPage, head = null) {
  const pages = [];
  let cur = null;
  const open = () => {
    const n = pages.length;
    const pg = newPage(n);
    const top = head?.(n);
    if (top) pg.body.append(top);
    pg.count = 0;
    pages.push(pg);
    cur = pg;
  };
  const overflows = () => cur.body.scrollHeight > cur.body.clientHeight + 1;
  open();
  for (const b of blocks) {
    if (b.dataset.break === 'before' && cur.count > 0) open();
    cur.body.append(b);
    cur.count++;
    if (!overflows()) continue;
    if (b.dataset.optional) { b.remove(); cur.count--; continue; }
    if (cur.count === 1) { b.classList.add('lb-too-tall'); continue; } // can't do better than a page of its own
    b.remove();
    cur.count--;
    // headings stay with what follows them
    const carry = [];
    while (cur.count - carry.length > 1) {
      const last = cur.body.lastElementChild;
      if (!last || last.dataset.keep !== 'next' || carry.includes(last)) break;
      carry.unshift(last);
      last.remove();
    }
    cur.count -= carry.length;
    open();
    for (const c of carry) { cur.body.append(c); cur.count++; }
    cur.body.append(b);
    cur.count++;
    if (overflows() && cur.count > 1) b.classList.add('lb-too-tall');
  }
  return pages.map((p) => p.el);
}
