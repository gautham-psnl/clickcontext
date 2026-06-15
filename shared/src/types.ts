export interface DomLayer {
  html: string;
  tag: string;
  attributes: Record<string, string>;
  domPath: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
}

export interface AccessibilityLayer {
  role: string;
  name: string;
  description: string;
  disabled: boolean;
  ariaHidden: boolean;
}

export interface HookInfo {
  type: string;
  value: unknown;
}

export interface ComponentFrame {
  name: string;
  props: unknown;
  hooks: HookInfo[] | null;
  source?: SourceLayer; // where this frame's element was created (resolved server-side)
  isUserComponent?: boolean; // resolved source is in the project, not node_modules/framework
}

export interface ComponentLayer {
  available: boolean;
  framework?: string;
  stack?: ComponentFrame[];
}

export interface SourceLayer {
  available: boolean;
  file?: string;
  line?: number;
  column?: number;
  provenance?: 'build-attr' | 'fiber-debug-source' | 'owner-stack';
  reason?: string;
  resolvedFile?: string; // Tier 1: absolute path the server resolved to
  resolvedLine?: number; // Tier 1b: original line after source-map resolution
  code?: string; // Tier 1: actual source lines around the resolved line
  resolveError?: string; // Tier 1: why code couldn't be read
}

export interface MissingLayer {
  layer: string;
  reason: string;
}

export interface UiContextMeta {
  url: string;
  capturedAt: string;
  layers: string[];
  missing: MissingLayer[];
}

export interface UiContext {
  dom: DomLayer;
  accessibility: AccessibilityLayer;
  component: ComponentLayer;
  source: SourceLayer;
  meta: UiContextMeta;
}
