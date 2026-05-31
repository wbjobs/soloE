declare module 'plotly.js-dist-min' {
  export interface Marker {
    color?: string;
    opacity?: number;
    size?: number;
    line?: {
      color?: string;
      width?: number;
    };
  }

  export interface Line {
    color?: string;
    width?: number;
    dash?: string;
  }

  export interface Data {
    type?: string;
    mode?: string;
    name?: string;
    x?: any;
    y?: any;
    z?: any;
    marker?: Marker;
    line?: Line;
    opacity?: number;
    showscale?: boolean;
    colorscale?: any;
    hoverinfo?: string;
    showlegend?: boolean;
    text?: string | string[];
  }

  export interface Axis {
    showgrid?: boolean;
    zeroline?: boolean;
    showticklabels?: boolean;
    title?: string;
    range?: number[];
    gridcolor?: string;
    tickangle?: number;
    zerolinecolor?: string;
  }

  export interface Camera {
    eye?: { x: number; y: number; z: number };
    center?: { x: number; y: number; z: number };
    up?: { x: number; y: number; z: number };
  }

  export interface Annotation {
    x?: number;
    y?: number;
    z?: number;
    text?: string;
    showarrow?: boolean;
    font?: {
      color?: string;
      size?: number;
      family?: string;
    };
  }

  export interface Scene {
    xaxis?: Partial<Axis>;
    yaxis?: Partial<Axis>;
    zaxis?: Partial<Axis>;
    camera?: Camera;
    annotations?: Annotation[];
  }

  export interface Layout {
    paper_bgcolor?: string;
    plot_bgcolor?: string;
    font?: {
      color?: string;
      family?: string;
    };
    title?: {
      text?: string;
      font?: {
        color?: string;
        size?: number;
      };
    };
    xaxis?: Partial<Axis>;
    yaxis?: Partial<Axis>;
    scene?: Scene;
    legend?: {
      x?: number;
      y?: number;
      bgcolor?: string;
      bordercolor?: string;
      borderwidth?: number;
    };
    margin?: {
      l?: number;
      r?: number;
      t?: number;
      b?: number;
    };
    barmode?: string;
    bargap?: number;
    bargroupgap?: number;
    showlegend?: boolean;
  }

  export interface Config {
    responsive?: boolean;
    displayModeBar?: boolean;
  }

  export function newPlot(
    div: HTMLElement,
    data: Data[],
    layout?: Partial<Layout>,
    config?: Partial<Config>
  ): Promise<void>;

  export function react(
    div: HTMLElement,
    data: Data[],
    layout?: Partial<Layout>,
    config?: Partial<Config>
  ): Promise<void>;

  export default {
    newPlot,
    react,
  };
}
