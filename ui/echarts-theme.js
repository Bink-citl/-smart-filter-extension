/* v2.9.0 图表配色跟令牌走：浅色、深色各一套，颜色从 ui/tokens.css 读（HRSTheme.tok），不在这里写死
 * 切换浅色 / 深色时，页面上已经画好的图表按新配色重画（整页重新载入，停留的标签页不变）
 * v2.2.2 坐标轴去线，网格线改成很淡的虚线 */
(function () {
  'use strict';
  if (!window.echarts) return;
  var T = function (n, d) { return (window.HRSTheme && HRSTheme.tok(n)) || d; };
  function build() {
    return {
      color: [T('--chart-1', '#0B3A6E'), T('--chart-2', '#0E9AA7'), T('--chart-3', '#5D7FA8'), T('--chart-4', '#9DB3CB'), T('--chart-5', '#4A5568'), T('--chart-6', '#2F6690')],
      backgroundColor: 'transparent',
      textStyle: { fontFamily: '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif', color: T('--text-2', '#4A5568') },
      categoryAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T('--chart-axis', '#8792A2') }, splitLine: { show: false } },
      valueAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T('--chart-axis', '#8792A2') }, splitLine: { lineStyle: { color: T('--chart-grid', '#EDF0F4'), type: 'dashed' } } },
      legend: { textStyle: { color: T('--text-2', '#4A5568') } },
      tooltip: { backgroundColor: T('--brand-900', '#0A1A2E'), borderWidth: 0, textStyle: { color: T('--on-color', '#FFFFFF'), fontSize: 12 } }
    };
  }
  var made = 0;
  var init = echarts.init;
  echarts.init = function (dom, theme, opts) {
    if (!theme || theme === 'hrs') { echarts.registerTheme('hrs', build()); theme = 'hrs'; }
    made++;
    return init.call(echarts, dom, theme, opts);
  };
  /** 图表里单独指定的颜色也走令牌：HRSChart.c('--chart-bad') */
  window.HRSChart = { c: T };
  if (window.HRSTheme) HRSTheme.onChange(function () { if (made) location.reload(); });
})();
