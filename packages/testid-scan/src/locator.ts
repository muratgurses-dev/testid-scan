/**
 * Playwright locator suggestions. They are written from what the scanner read in the source;
 * none of them has been run against a page.
 */

/** A JavaScript string literal in single quotes. */
export function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\r?\n/g, '\\n')}'`;
}

const ROLES: Record<string, string> = {
  button: 'button', link: 'link', checkbox: 'checkbox', radio: 'radio', tab: 'tab', option: 'option',
  heading: 'heading', 'menu-item': 'menuitem', toggle: 'switch', table: 'table',
};

/**
 * The call that finds an element by what a user perceives, without the leading "page.".
 * Names are matched exactly: by default Playwright also accepts a name that merely contains the text.
 * Returns undefined for kinds with no dependable role (a panel header, a step, a plain container).
 */
export function nameLocator(kind: string, tag: string, name: string): string | undefined {
  const exact = `{ name: ${quote(name)}, exact: true }`;
  // a form control's role depends on its type (textbox, spinbutton, searchbox, none for a password), its label does not
  if (kind === 'input' || kind === 'select' || kind === 'spinner') return `getByLabel(${quote(name)}, { exact: true })`;
  if (kind === 'message') return `getByText(${quote(name)}, { exact: true })`;
  // a button toggle is a pressed/unpressed button, not a switch
  if (kind === 'toggle' && /button-?toggle|toggle-?button/i.test(tag)) return `getByRole('button', ${exact})`;
  const role = ROLES[kind];
  return role ? `getByRole(${quote(role)}, ${exact})` : undefined;
}

/** data-order-id from [attr.data-order-id], :data-order-id, v-bind:data-order-id or data-order-id. */
export function attributeName(written: string): string {
  return written.replace(/^\[attr\.|^\[|^v-bind:|^:/, '').replace(/\]$/, '');
}
