/** Create an element in a specific document (Obsidian views can live in pop-out windows). */
export function el<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
    cls?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Text of a subtree as the user sees it: text nodes plus "\n" for each <br>. */
export function readText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
    if (node.nodeName === "BR") return "\n";
    let out = "";
    node.childNodes.forEach((child) => (out += readText(child)));
    return out;
}

/** Visit every text node and <br> under `root` with its offset in `readText(root)`. */
export function walkText(
    root: Node,
    visit: (node: Text | null, offset: number, length: number) => void,
): number {
    let offset = 0;
    const step = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const len = (node as Text).data.length;
            visit(node as Text, offset, len);
            offset += len;
        } else if (node.nodeName === "BR") {
            visit(null, offset, 1);
            offset += 1;
        } else {
            node.childNodes.forEach(step);
        }
    };
    step(root);
    return offset;
}

/** A DOM range covering characters [start, end) of `root`'s text. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
    const doc = root.ownerDocument!;
    const range = doc.createRange();
    let haveStart = false;
    let haveEnd = false;
    walkText(root, (node, offset, length) => {
        if (!node) return;
        if (!haveStart && start >= offset && start < offset + length) {
            range.setStart(node, start - offset);
            haveStart = true;
        }
        if (haveStart && !haveEnd && end > offset && end <= offset + length) {
            range.setEnd(node, end - offset);
            haveEnd = true;
        }
    });
    return haveStart && haveEnd ? range : null;
}
