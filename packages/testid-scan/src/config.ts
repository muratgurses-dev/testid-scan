import { readFileSync } from 'node:fs';

/** A React component the scanner should treat as an interactive element. */
export interface ComponentSpec {
  kind: string;
  /** Props that hold the accessible name. Default: ["label"]. aria-label and children are always considered. */
  nameProps?: string[];
}

export interface Config {
  /** Which kind of project to read. "auto" looks at the nearest package.json. */
  framework: 'auto' | 'angular' | 'react' | 'vue';
  /** Attribute that holds the test ID, e.g. data-testid, data-test, data-cy, data-qa. */
  testIdAttribute: string;
  /** Allowed first word(s) of a test ID. Empty = any prefix is accepted. */
  prefixes: string[];
  /** Allowed last word(s) of a test ID (its "type"). Empty = no suffix rule. */
  suffixes: string[];
  /** Which suffixes fit which kind of element. A kind that is not listed is never checked. */
  suffixesByKind: Record<string, string[]>;
  /** Report a test ID whose suffix does not fit the element, e.g. a button named "...-table". */
  checkSuffixMatchesKind: boolean;
  /**
   * Require every test ID to be <context>-<type> and to end in one of `suffixes` (orders-save-button).
   * Off by default: it is a team convention, not a general rule. Kebab-case, prefixes and duplicates are always checked.
   */
  requireTypeSuffix: boolean;
  /** Require a test ID on every element instead of "role first, test ID where needed". */
  strict: boolean;
  /**
   * Look across files: a component that another template renders in a loop, or more than once,
   * repeats everything inside it.
   */
  followComponents: boolean;
  /** Angular: scan every *.html file instead of only *.component.html. */
  allHtml: boolean;
  /** Angular: scan `template: \`...\`` strings inside @Component files. */
  inlineTemplates: boolean;
  /** Folder names that are never entered. */
  ignoreDirs: string[];
  /** Angular: pipes that translate a fixed key, e.g. {{ 'SAVE' | translate }}. */
  translatePipes: string[];
  /** Optional JSON file with translations; keys are resolved to their text when given. */
  i18nFile: string;
  /** React and Vue: functions that translate a fixed key, e.g. t('SAVE') or $t('SAVE'). */
  translateFunctions: string[];
  /** React: translation components and the prop that holds the key, e.g. <Trans i18nKey="SAVE" />. */
  translateComponents: Record<string, string>;
  /** Angular: tag name -> kind. Add your own components here, e.g. { "p-dropdown": "select" }. "" removes a default. */
  elements: Record<string, string>;
  /** Angular: attribute name -> kind, e.g. { "pButton": "button" }. "" removes a default. */
  attributes: Record<string, string>;
  /**
   * React and Vue: component name -> kind (or { kind, nameProps }). "" removes a default.
   * React names are case-sensitive; in Vue "v-btn" and "VBtn" are the same entry.
   */
  components: Record<string, string | ComponentSpec>;
  /**
   * React: property names of cell renderers in a column list, e.g. columns={[{ cell: ({ row }) => <a>View</a> }]}.
   * What they return is rendered once per row.
   */
  cellRenderers: string[];
  /** React: props that take a function rendering one row or item, e.g. <List renderItem={(item) => ...} />. */
  rowRenderProps: string[];
  /** React: file extensions that contain JSX. Add ".js" if your components live in .js files. */
  reactExtensions: string[];
  /** Tags/components that are decorative icons and never part of a name. */
  iconTags: string[];
  /** React: components whose name matches this pattern are icons too (regular expression). "" switches it off. */
  iconNamePattern: string;
  /**
   * Angular Material before version 15 turns the placeholder of a field inside <mat-form-field> into its
   * label, so the field has a name. "auto" reads the version from the nearest package.json.
   */
  placeholderAsLabel: 'auto' | 'always' | 'never';
  /** Form field wrapper tag -> the tag that holds its label, or "@attr" when the wrapper carries it as an attribute. */
  formFields: Record<string, string>;
  /** Angular: structural directives that repeat their host once per record. */
  repeatDirectives: string[];
}

export const defaultConfig: Config = {
  framework: 'auto',
  testIdAttribute: 'data-testid',
  prefixes: [],
  suffixes: ['button', 'link', 'input', 'select', 'option', 'checkbox', 'radio', 'toggle', 'date', 'upload', 'tab', 'step', 'panel',
    'form', 'header', 'dialog', 'menu', 'menu-item', 'menu-button', 'heading', 'message', 'list', 'table', 'row', 'item', 'card',
    'count', 'chart', 'toast', 'spinner'],
  suffixesByKind: {
    button: ['button', 'menu-button', 'upload', 'toggle', 'tab', 'item'],
    link: ['link', 'item', 'tab', 'card'],
    input: ['input', 'date', 'upload', 'select'],
    select: ['select', 'input'],
    option: ['option', 'item'],
    checkbox: ['checkbox', 'toggle', 'item'],
    radio: ['radio', 'option', 'item'],
    toggle: ['toggle', 'button', 'checkbox'],
    tab: ['tab'],
    step: ['step'],
    header: ['header', 'panel', 'button'],
    table: ['table', 'list'],
    row: ['row', 'item'],
    heading: ['heading', 'header'],
    message: ['message', 'toast'],
    spinner: ['spinner'],
    'menu-item': ['menu-item', 'item', 'button', 'link'],
  },
  checkSuffixMatchesKind: true,
  requireTypeSuffix: false,
  strict: false,
  followComponents: true,
  allHtml: false,
  inlineTemplates: true,
  ignoreDirs: ['node_modules', 'dist', 'build', '.angular', '.next', '.git', 'coverage', '__tests__', '__mocks__'],
  translatePipes: ['translate', 'transloco', 'i18n'],
  i18nFile: '',
  translateFunctions: ['t', '$t', 'i18n.t', 'i18next.t'],
  translateComponents: { Trans: 'i18nKey', FormattedMessage: 'id' },
  elements: {
    button: 'button', textarea: 'input', select: 'select', table: 'table',
    'mat-select': 'select', 'mat-option': 'option', 'mat-checkbox': 'checkbox', 'mat-radio-button': 'radio',
    'mat-slide-toggle': 'toggle', 'mat-slider': 'input', 'mat-datepicker-toggle': 'button', 'mat-button-toggle': 'toggle', 'mat-chip-option': 'option', 'mat-list-option': 'option',
    'mat-expansion-panel-header': 'header', 'mat-error': 'message',
    'mat-spinner': 'spinner', 'mat-progress-bar': 'spinner', 'mat-progress-spinner': 'spinner',
    'mat-table': 'table', 'cdk-table': 'table', 'mat-row': 'row', 'cdk-row': 'row',
  },
  attributes: {
    'mat-menu-item': 'menu-item', 'mat-row': 'row', 'cdk-row': 'row', 'mat-sort-header': 'header',
    'mat-tab-label': 'tab', mattablabel: 'tab', 'mat-tab-link': 'tab', matsteplabel: 'step',
    'mat-dialog-title': 'heading', matdialogtitle: 'heading',
  },
  // Conventional names shared by MUI, Chakra, Ant Design, React Router and most in-house libraries.
  components: {
    Button: 'button', IconButton: 'button', Fab: 'button', ToggleButton: 'toggle',
    Link: 'link', NavLink: 'link',
    TextField: { kind: 'input', nameProps: ['label'] }, Input: 'input', Textarea: 'input', TextArea: 'input',
    Select: { kind: 'select', nameProps: ['label'] },
    Checkbox: { kind: 'checkbox', nameProps: ['label'] }, Radio: { kind: 'radio', nameProps: ['label'] },
    Switch: { kind: 'toggle', nameProps: ['label'] },
    MenuItem: 'menu-item', Tab: { kind: 'tab', nameProps: ['label'] },
    Table: 'table', TableRow: 'row',
    CircularProgress: 'spinner', LinearProgress: 'spinner', Spinner: 'spinner',
    // Vue: router, Vuetify, Element Plus, Quasar
    'router-link': 'link', 'nuxt-link': 'link',
    'v-btn': 'button', 'v-text-field': { kind: 'input', nameProps: ['label'] }, 'v-textarea': { kind: 'input', nameProps: ['label'] },
    'v-select': { kind: 'select', nameProps: ['label'] }, 'v-autocomplete': { kind: 'select', nameProps: ['label'] },
    'v-checkbox': { kind: 'checkbox', nameProps: ['label'] }, 'v-switch': { kind: 'toggle', nameProps: ['label'] },
    'v-radio': { kind: 'radio', nameProps: ['label'] }, 'v-tab': 'tab', 'v-progress-circular': 'spinner', 'v-progress-linear': 'spinner',
    'el-button': 'button', 'el-input': 'input', 'el-select': 'select', 'el-checkbox': 'checkbox', 'el-radio': 'radio', 'el-switch': 'toggle',
    'q-btn': { kind: 'button', nameProps: ['label'] }, 'q-input': { kind: 'input', nameProps: ['label'] },
    'q-select': { kind: 'select', nameProps: ['label'] }, 'q-checkbox': { kind: 'checkbox', nameProps: ['label'] },
    'q-toggle': { kind: 'toggle', nameProps: ['label'] },
  },
  cellRenderers: ['cell', 'Cell', 'render', 'renderCell', 'cellRenderer', 'body', 'formatter'],
  rowRenderProps: ['renderItem', 'renderRow', 'renderCell', 'rowRenderer', 'cellRenderer', 'itemContent'],
  reactExtensions: ['.tsx', '.jsx'],
  iconTags: ['mat-icon', 'svg', 'v-icon', 'el-icon', 'q-icon', 'font-awesome-icon'],
  iconNamePattern: 'Icon$',
  placeholderAsLabel: 'auto',
  formFields: { 'mat-form-field': 'mat-label', FormControl: 'InputLabel', 'el-form-item': '@label' },
  repeatDirectives: ['*ngfor', 'ngfor', '*matrowdef', '*cdkrowdef', '*matcelldef', '*cdkcelldef', '*cdkvirtualfor'],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const lower = (s: string) => s.toLowerCase();

/** Angular matches tags and attributes case-insensitively, so the keys of these maps are lowercased. */
const LOWERCASE_KEYS = new Set(['elements', 'attributes']);

/** Arrays and simple values replace the default; maps (elements, attributes, components, ...) are merged into it. */
export function mergeConfig(base: Config, over: Partial<Config> = {}): Config {
  const out = { ...base } as unknown as Record<string, unknown>;
  const defaults = defaultConfig as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined || key.startsWith('$')) continue;
    if (!(key in defaults)) throw new Error(`Unknown option "${key}". Known options: ${Object.keys(defaults).join(', ')}`);
    const expected = defaults[key];
    if (Array.isArray(expected) !== Array.isArray(value) || (!Array.isArray(expected) && typeof expected !== typeof value)) {
      throw new Error(`Option "${key}" has the wrong type`);
    }
    if (isPlainObject(expected) && isPlainObject(value)) {
      const entries = LOWERCASE_KEYS.has(key) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [lower(k), v])) : value;
      out[key] = { ...(out[key] as Record<string, unknown>), ...entries };
    } else {
      out[key] = value;
    }
  }
  const cfg = out as unknown as Config;
  if (!['auto', 'angular', 'react', 'vue'].includes(cfg.framework)) throw new Error(`Option "framework" must be auto, angular, react or vue`);
  if (!['auto', 'always', 'never'].includes(cfg.placeholderAsLabel)) throw new Error(`Option "placeholderAsLabel" must be auto, always or never`);
  if (cfg.iconNamePattern) {
    try { new RegExp(cfg.iconNamePattern); } catch { throw new Error(`Option "iconNamePattern" is not a valid regular expression`); }
  }
  // Angular templates are matched case-insensitively here, so normalise what is compared against them.
  cfg.testIdAttribute = lower(cfg.testIdAttribute);
  cfg.iconTags = cfg.iconTags.map(lower);
  cfg.repeatDirectives = cfg.repeatDirectives.map(lower);
  return cfg;
}

export function loadConfigFile(path: string): Partial<Config> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read config file ${path}: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) throw new Error(`Config file ${path} must contain a JSON object`);
  return parsed as Partial<Config>;
}
