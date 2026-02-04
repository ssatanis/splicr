declare module 'react-plotly.js' {
  import { Component } from 'react';
  interface PlotParams {
    data: object[];
    layout?: object;
    config?: object;
    style?: object;
    useResizeHandler?: boolean;
    [key: string]: unknown;
  }
  export default class Plot extends Component<PlotParams> {}
}
