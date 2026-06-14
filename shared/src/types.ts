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
  reason?: string;
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
