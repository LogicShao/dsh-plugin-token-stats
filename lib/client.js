window.__ModuleLoader__.load({
  id: "dsh-plugin-token-stats",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");
    let dsh_client_store = require("@deepseek-ai/dsh-client-store");

    const jsx = react_jsx_runtime.jsx;
    const jsxs = react_jsx_runtime.jsxs;

    // ---------------------------------------------------------------------
    // Localization
    // ---------------------------------------------------------------------
    const NS = "token-stats";

    const zh = {
      nav: "Token 用量",
      title: "Token 用量统计",
      intro: "跨会话统计 token 消耗、成本估算与模型/项目分布。数据来自本机 Session 日志，每 30 秒自动刷新。",
      range7: "7 天",
      range30: "30 天",
      range90: "90 天",
      rangeAll: "全部",
      refresh: "刷新",
      refreshing: "刷新中…",
      exportCsv: "导出 CSV",
      updatedAt: "更新于 {time}",
      notUpdated: "尚未更新",
      loading: "正在加载用量数据…",
      errorTitle: "加载用量数据失败",
      retry: "重试",
      emptyTitle: "暂无 token 用量",
      emptyHint: "完成一次会话后，这里会显示每日消耗、模型分布与会话排行。",
      today: "今日",
      yesterday: "昨日",
      last7: "近 7 天",
      total: "总计",
      requestsUnit: "次请求",
      sessionsUnit: "个会话",
      cnyApprox: "≈ {amount}",
      tokensUnit: "tokens",
      chartTitle: "{unit} token 消耗",
      chartHint: "悬停查看明细",
      chartTip: "{day} · {tokens} tokens · {cost}",
      unitDay: "每日",
      unitWeek: "每周",
      unitMonth: "每月",
      modelsTitle: "模型分布",
      projectsTitle: "项目分布",
      sessionsTitle: "会话排行",
      highlightsTitle: "亮点",
      projectSessions: "{count} 个会话",
      untitled: "未命名会话",
      live: "进行中",
      subagent: "子会话",
      colSession: "会话",
      colTokens: "Tokens",
      colCost: "成本",
      colLastActive: "最后活动",
      showAllSessions: "显示全部 {count} 个会话",
      showLess: "收起",
      streakLabel: "连续使用",
      streakValue: "{days} 天",
      cacheHitLabel: "缓存命中率",
      busiestLabel: "最忙一天",
      longestLabel: "单会话最高",
      projectedLabel: "本月预测",
      pricesUnmatched: "{count} 个模型未配置价格，按 $0 计",
      pricesUnmatchedOne: "1 个模型未配置价格，按 $0 计",
      timeAwareNote: "成本按 DeepSeek 官方峰谷价估算：北京时间工作日 09:00–12:00 / 14:00–18:00 为高峰价，其余为闲时价",
      timeAwareWindow: "成本按 DeepSeek 官方峰谷价估算：{window}",
      generatedAt: "生成于 {time}",
      timeZoneLabel: "时区 {zone}",
      noData: "无数据",
    };

    const en = {
      nav: "Token usage",
      title: "Token usage",
      intro: "Cross-session token consumption, cost estimates, and model/project breakdowns. Data comes from local session logs and refreshes every 30 seconds.",
      range7: "7 days",
      range30: "30 days",
      range90: "90 days",
      rangeAll: "All",
      refresh: "Refresh",
      refreshing: "Refreshing…",
      exportCsv: "Export CSV",
      updatedAt: "Updated {time}",
      notUpdated: "Not updated yet",
      loading: "Loading usage data…",
      errorTitle: "Could not load usage data",
      retry: "Retry",
      emptyTitle: "No token usage yet",
      emptyHint: "Once a session runs, daily spend, model breakdown, and session rankings appear here.",
      today: "Today",
      yesterday: "Yesterday",
      last7: "Last 7 days",
      total: "Total",
      requestsUnit: "requests",
      sessionsUnit: "sessions",
      cnyApprox: "≈ {amount}",
      tokensUnit: "tokens",
      chartTitle: "{unit} token spend",
      chartHint: "Hover a bar for details",
      chartTip: "{day} · {tokens} tokens · {cost}",
      unitDay: "Daily",
      unitWeek: "Weekly",
      unitMonth: "Monthly",
      modelsTitle: "By model",
      projectsTitle: "By project",
      sessionsTitle: "Top sessions",
      highlightsTitle: "Highlights",
      projectSessions: "{count} sessions",
      untitled: "Untitled session",
      live: "Live",
      subagent: "Sub-session",
      colSession: "Session",
      colTokens: "Tokens",
      colCost: "Cost",
      colLastActive: "Last active",
      showAllSessions: "Show all {count} sessions",
      showLess: "Show less",
      streakLabel: "Streak",
      streakValue: "{days} days",
      cacheHitLabel: "Cache hit rate",
      busiestLabel: "Busiest day",
      longestLabel: "Top session",
      projectedLabel: "Projected this month",
      pricesUnmatched: "{count} models lack prices; counted as $0",
      pricesUnmatchedOne: "1 model lacks a price; counted as $0",
      timeAwareNote: "Costs use DeepSeek official peak/off-peak pricing: weekdays 09:00–12:00 and 14:00–18:00 (Beijing time) are peak; other times are off-peak.",
      timeAwareWindow: "Costs use DeepSeek official peak/off-peak pricing: {window}",
      generatedAt: "Generated {time}",
      timeZoneLabel: "Time zone {zone}",
      noData: "No data",
    };

    // ---------------------------------------------------------------------
    // Stylesheet (injected once; colors come from the DSH theme variables)
    // ---------------------------------------------------------------------
    const CSS_TAG_ID = "dsh-plugin-token-stats/dashboard.css";
    const CSS_TEXT =
      ".ts_section{display:flex;flex-direction:column;gap:12px;min-width:0;max-width:760px;color:var(--dsw-alias-label-primary)}" +
      ".ts_title{margin:0;font-size:18px;font-weight:600;line-height:1.4}" +
      ".ts_intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
      ".ts_dash{display:flex;flex-direction:column;gap:12px;min-width:0;container-type:inline-size;container-name:tsdash}" +
      ".ts_toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
      ".ts_ranges{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ts_rangeBtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}" +
      ".ts_rangeBtn:hover{color:var(--dsw-alias-label-primary)}" +
      ".ts_rangeBtn[data-active=true]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);font-weight:600}" +
      ".ts_toolbarRight{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}" +
      ".ts_updated{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_btn{appearance:none;font:inherit;font-size:12px;line-height:18px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}" +
      ".ts_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".ts_btn:disabled{opacity:.45;cursor:default}" +
      ".ts_metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}" +
      ".ts_metric{display:flex;flex-direction:column;gap:2px;min-width:0;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill)}" +
      ".ts_metricLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}" +
      ".ts_metricValue{display:flex;align-items:baseline;gap:3px;color:var(--dsw-alias-label-primary);font-size:24px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}" +
      ".ts_metricUnit{color:var(--dsw-alias-label-caption);font-size:11px;font-weight:400;line-height:16px}" +
      ".ts_metricSub{display:flex;align-items:baseline;justify-content:space-between;gap:6px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}" +
      ".ts_metricSubText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_metricCny{flex:none;white-space:nowrap}" +
      ".ts_panel{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill)}" +
      ".ts_panelHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}" +
      ".ts_panelTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
      ".ts_panelHint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}" +
      ".ts_grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}" +
      ".ts_chartScroll{padding:2px 0 0;overflow:visible}" +
      ".ts_chartScroll[data-scroll=true]{overflow-x:auto;overflow-y:hidden}" +
      ".ts_chart{display:flex;align-items:flex-end;gap:2px;height:120px;min-width:100%}" +
      ".ts_barWrap{position:relative;display:flex;align-items:flex-end;flex:1 1 0;min-width:3px;height:100%}" +
      ".ts_bar{width:100%;min-height:1px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary);opacity:.88}" +
      ".ts_barWrap[data-zero=true] .ts_bar{opacity:.16}" +
      ".ts_barWrap:hover .ts_bar{opacity:1}" +
      ".ts_barTip{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);z-index:2;opacity:0;pointer-events:none;transition:opacity .12s;white-space:nowrap;padding:3px 7px;border-radius:6px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font-size:11px;line-height:16px}" +
      ".ts_barWrap:hover .ts_barTip{opacity:1}" +
      ".ts_barWrap[data-edge=start] .ts_barTip{left:0;transform:none}" +
      ".ts_barWrap[data-edge=end] .ts_barTip{left:auto;right:0;transform:none}" +
      ".ts_chartAxis{display:flex;align-items:center;justify-content:space-between;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}" +
      ".ts_rows{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}" +
      ".ts_row{display:grid;grid-template-columns:minmax(0,1fr) 88px 112px;align-items:center;gap:10px;min-width:0}" +
      ".ts_rowMain{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ts_rowName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_rowSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_track{height:6px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ts_trackFill{height:100%;border-radius:999px}" +
      ".ts_rowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_sessionList{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}" +
      ".ts_session{display:grid;grid-template-columns:minmax(0,1fr) 76px 76px 64px;align-items:center;gap:10px;min-width:0;padding:7px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}" +
      ".ts_session:last-child{border-bottom:0}" +
      ".ts_sessionHead{padding:0 0 5px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}" +
      ".ts_sessionHead .ts_sessionNum,.ts_sessionHead .ts_sessionTime{color:var(--dsw-alias-label-caption);font-size:11px}" +
      ".ts_sessionMain{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ts_sessionTitle{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;min-width:0}" +
      ".ts_sessionTitleText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_liveDot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-state-success-primary)}" +
      ".ts_badge{flex:none;color:var(--dsw-alias-label-caption);font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2)}" +
      ".ts_sessionSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_sessionNum{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_sessionCost{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_sessionTime{color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_more{display:flex;justify-content:center;padding-top:2px}" +
      ".ts_highlightGroup{display:flex;flex-direction:column;gap:8px;min-width:0}" +
      ".ts_groupHead{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;letter-spacing:.06em}" +
      ".ts_highlights{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}" +
      ".ts_highlight{display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ts_highlightLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_highlightValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:22px;white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".ts_highlightSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ts_state{display:flex;align-items:center;justify-content:center;gap:8px;padding:30px 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}" +
      ".ts_spinner{flex:none;width:14px;height:14px;border-radius:999px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);animation:ts_spin .8s linear infinite}" +
      "@keyframes ts_spin{to{transform:rotate(360deg)}}" +
      ".ts_error{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}" +
      ".ts_errorText{flex:1;min-width:0;overflow-wrap:anywhere}" +
      ".ts_empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px 16px;text-align:center}" +
      ".ts_emptyTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}" +
      ".ts_emptyHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}" +
      ".ts_footnote{display:flex;flex-wrap:wrap;gap:12px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}" +
      ".ts_timeAware{flex-basis:100%;color:var(--dsw-alias-label-tertiary)}" +
      ".ts_previewRoot{box-sizing:border-box;min-height:100vh;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:-apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif}" +
      ".ts_previewRoot .ts_section{max-width:820px}" +
      "@media (max-width:720px){.ts_metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ts_grid2{grid-template-columns:minmax(0,1fr)}.ts_highlights{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@container tsdash (max-width: 700px){.ts_grid2{grid-template-columns:minmax(0,1fr)}.ts_highlights{grid-template-columns:repeat(3,minmax(0,1fr))}}" +
      "@container tsdash (max-width: 640px){.ts_row{grid-template-columns:minmax(0,1fr) 64px 96px}.ts_session{grid-template-columns:minmax(0,1fr) 64px 64px 52px}.ts_metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@container tsdash (max-width: 430px){.ts_metrics{grid-template-columns:minmax(0,1fr)}.ts_highlights{grid-template-columns:repeat(2,minmax(0,1fr))}}";

    function injectStyles() {
      if (typeof document === "undefined" || typeof document.createElement !== "function") return;
      try {
        if (typeof document.querySelector === "function") {
          var selector = "style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]";
          if (document.querySelector(selector) !== null) return;
        }
        var tag = document.createElement("style");
        tag.dataset.plugin = "dsh-plugin-token-stats";
        tag.dataset.pluginCss = CSS_TAG_ID;
        tag.textContent = CSS_TEXT;
        if (document.head && typeof document.head.appendChild === "function") document.head.appendChild(tag);
      } catch (_error) {
        /* styling is best effort; never fail the plugin for it */
      }
    }

    injectStyles();

    // ---------------------------------------------------------------------
    // Pure formatting / aggregation helpers (unit-tested through __test)
    // ---------------------------------------------------------------------
    /** Theme references only: every color the dashboard paints comes from DSH. */
    const COLOR_TOKENS = Object.freeze({
      text: "var(--dsw-alias-label-primary)",
      textSecondary: "var(--dsw-alias-label-secondary)",
      textTertiary: "var(--dsw-alias-label-tertiary)",
      textCaption: "var(--dsw-alias-label-caption)",
      cardFill: "var(--dsw-alias-settings-card-fill)",
      cardStroke: "var(--dsw-alias-settings-card-stroke)",
      border: "var(--dsw-alias-border-l2)",
      brand: "var(--dsw-alias-brand-primary)",
      hover: "var(--dsw-alias-interactive-bg-hover)",
      success: "var(--dsw-alias-state-success-primary)",
      warn: "var(--dsw-alias-state-warn-primary)",
    });

    function barColor() {
      return COLOR_TOKENS.brand;
    }

    function toFiniteNumber(value) {
      var number = typeof value === "number" ? value : Number(value);
      return isFinite(number) ? number : 0;
    }

    function pad2(value) {
      var text = String(Math.floor(Math.abs(value)));
      return text.length >= 2 ? text : "0" + text;
    }

    function getDate(value) {
      if (value instanceof Date) return isNaN(value.getTime()) ? new Date(0) : value;
      var number = typeof value === "number" ? value : Number(value);
      if (!isFinite(number)) return new Date(0);
      return new Date(number);
    }

    function formatInt(value) {
      var number = Math.round(toFiniteNumber(value));
      var negative = number < 0;
      var digits = String(Math.abs(number));
      var out = "";
      for (var index = 0; index < digits.length; index += 1) {
        out += digits.charAt(index);
        var remaining = digits.length - 1 - index;
        if (remaining > 0 && remaining % 3 === 0) out += ",";
      }
      return (negative ? "-" : "") + out;
    }

    function formatCompact(value) {
      var number = toFiniteNumber(value);
      var sign = number < 0 ? "-" : "";
      var abs = Math.abs(number);
      var units = [
        { size: 1e9, suffix: "B" },
        { size: 1e6, suffix: "M" },
        { size: 1e3, suffix: "K" },
      ];
      for (var index = 0; index < units.length; index += 1) {
        var unit = units[index];
        if (abs < unit.size) continue;
        var scaled = abs / unit.size;
        var digits = scaled >= 100 ? 0 : 1;
        var text = scaled.toFixed(digits).replace(/\.0$/, "");
        return sign + text + unit.suffix;
      }
      return sign + String(Math.round(abs));
    }

    function trimMoneyDecimals(text) {
      if (text.indexOf(".") === -1) return text;
      var parts = text.split(".");
      var fraction = parts[1];
      while (fraction.length > 2 && fraction.charAt(fraction.length - 1) === "0") {
        fraction = fraction.slice(0, -1);
      }
      return parts[0] + "." + fraction;
    }

    function formatMoney(amount, symbol) {
      var number = toFiniteNumber(amount);
      var unit = typeof symbol === "string" ? symbol : "$";
      if (number === 0) return unit + "0.00";
      var abs = Math.abs(number);
      var digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
      return unit + trimMoneyDecimals(number.toFixed(digits));
    }

    function formatUsd(value) {
      return formatMoney(value, "$");
    }

    function formatCny(value) {
      return formatMoney(value, "¥");
    }

    function formatPercent(share) {
      var ratio = toFiniteNumber(share);
      var percent = ratio * 100;
      if (percent > 0 && percent < 0.1) return "<0.1%";
      if (percent >= 100) return "100%";
      return percent.toFixed(1).replace(/\.0$/, "") + "%";
    }

    function barWidth(value, max) {
      var number = toFiniteNumber(value);
      var ceiling = toFiniteNumber(max);
      if (ceiling <= 0 || number <= 0) return 0;
      var percent = (number / ceiling) * 100;
      if (!isFinite(percent)) return 0;
      return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    }

    function trackFillStyle(value, max) {
      return { width: barWidth(value, max) + "%", background: barColor() };
    }

    function formatDayFromMs(value) {
      var date = getDate(value);
      return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    }

    function formatDayShort(value) {
      var day = typeof value === "string" ? value : formatDayFromMs(value);
      var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
      return match === null ? day : match[2] + "-" + match[3];
    }

    // ---------------------------------------------------------------------
    // Adaptive chart buckets
    //
    // One bar per day stops being readable once a range spans months: 90 bars
    // overflow the panel and "all history" scrolls forever. Bucket the daily
    // series by calendar week / month as the span grows, so the chart always
    // stays in the 7–30 bar range without horizontal scrolling.
    // ---------------------------------------------------------------------
    const DAY_MS = 86400000;
    const BUCKET_DAY_LIMIT = 45;
    const BUCKET_WEEK_LIMIT = 190;
    const METRIC_FIELDS = [
      "requests",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "reasoningTokens",
      "totalTokens",
    ];

    /** `YYYY-MM-DD` → UTC midnight in ms (NaN when the string is not a day key). */
    function dayKeyToUtcMs(day) {
      var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof day === "string" ? day : "");
      return match === null ? NaN : Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function utcMsToDayKey(ms) {
      var date = new Date(ms);
      return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
    }

    function shiftDay(day, count) {
      var ms = dayKeyToUtcMs(day);
      return isFinite(ms) ? utcMsToDayKey(ms + count * DAY_MS) : day;
    }

    /** Monday of the week that contains `day` (ISO weeks; Sunday belongs to the previous Monday). */
    function startOfWeek(day) {
      var ms = dayKeyToUtcMs(day);
      if (!isFinite(ms)) return day;
      var weekday = new Date(ms).getUTCDay();
      return utcMsToDayKey(ms - ((weekday + 6) % 7) * DAY_MS);
    }

    function endOfMonth(day) {
      var ms = dayKeyToUtcMs(day);
      if (!isFinite(ms)) return day;
      var date = new Date(ms);
      return utcMsToDayKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    }

    /** Pick a bucket size for a range of `count` days: daily → weekly → monthly. */
    function granularityFor(count) {
      var days = toFiniteNumber(count);
      if (days <= BUCKET_DAY_LIMIT) return "day";
      if (days <= BUCKET_WEEK_LIMIT) return "week";
      return "month";
    }

    function createBucket(key, startDay, endDay) {
      var totals = {};
      for (var index = 0; index < METRIC_FIELDS.length; index += 1) totals[METRIC_FIELDS[index]] = 0;
      return {
        key: key,
        startDay: startDay,
        endDay: endDay,
        totals: totals,
        days: 0,
        costUsd: 0,
        costCny: 0,
      };
    }

    /**
     * Group the Host's daily series into day / week / month buckets.
     * Edge buckets stay clipped to the days that actually exist in the range,
     * so a range that starts mid-week still reports an honest start day.
     */
    function bucketDaily(daily) {
      var entries = Array.isArray(daily) ? daily : [];
      var granularity = granularityFor(entries.length);
      if (entries.length === 0) return { granularity: granularity, buckets: [] };
      var firstDay = typeof entries[0].day === "string" ? entries[0].day : "";
      var lastDay = typeof entries[entries.length - 1].day === "string" ? entries[entries.length - 1].day : "";
      var buckets = [];
      var byKey = Object.create(null);
      for (var entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        var entry = entries[entryIndex] || {};
        var day = typeof entry.day === "string" ? entry.day : "";
        var key;
        var startDay;
        var endDay;
        if (granularity === "day") {
          key = day;
          startDay = day;
          endDay = day;
        } else if (granularity === "week") {
          key = startOfWeek(day);
          startDay = key;
          endDay = shiftDay(key, 6);
        } else {
          key = day.slice(0, 7);
          startDay = day.slice(0, 7) + "-01";
          endDay = endOfMonth(day);
        }
        var bucket = byKey[key];
        if (bucket === undefined) {
          bucket = createBucket(key, startDay, endDay);
          byKey[key] = bucket;
          buckets.push(bucket);
        }
        var totals = entry.totals || {};
        for (var fieldIndex = 0; fieldIndex < METRIC_FIELDS.length; fieldIndex += 1) {
          var field = METRIC_FIELDS[fieldIndex];
          bucket.totals[field] += toFiniteNumber(totals[field]);
        }
        bucket.days += 1;
        bucket.costUsd += toFiniteNumber(entry.costUsd);
        bucket.costCny += toFiniteNumber(entry.costCny);
      }
      for (var bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
        var current = buckets[bucketIndex];
        if (firstDay !== "" && current.startDay < firstDay) current.startDay = firstDay;
        if (lastDay !== "" && current.endDay > lastDay) current.endDay = lastDay;
        current.costUsd = Math.round(current.costUsd * 1e6) / 1e6;
        current.costCny = Math.round(current.costCny * 1e6) / 1e6;
      }
      return { granularity: granularity, buckets: buckets };
    }

    function bucketAxisLabel(bucket, granularity) {
      if (bucket === undefined) return "";
      if (granularity === "month") return String(bucket.startDay).slice(0, 7);
      return formatDayShort(bucket.startDay);
    }

    function bucketTipLabel(bucket, granularity) {
      if (bucket === undefined) return "";
      var start = String(bucket.startDay);
      var end = String(bucket.endDay);
      if (granularity === "day") return start;
      // A complete calendar month reads best as "2026-09"; a clipped edge month
      // keeps its real first/last day so the tooltip never overstates coverage.
      if (granularity === "month" && start === start.slice(0, 7) + "-01" && end === endOfMonth(start)) {
        return start.slice(0, 7);
      }
      return start + " – " + end;
    }

    function formatClock(value) {
      var date = getDate(value);
      return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
    }

    function formatDateTime(value) {
      var date = getDate(value);
      return formatDayFromMs(date) + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
    }

    function formatDateTimeSeconds(value) {
      var date = getDate(value);
      return formatDayFromMs(date) + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
    }

    function formatText(template, params) {
      var text = template === undefined || template === null ? "" : String(template);
      if (params === undefined || params === null || typeof params !== "object") return text;
      return text.replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
        return params[name] === undefined || params[name] === null ? match : String(params[name]);
      });
    }

    function basename(path) {
      if (typeof path !== "string" || path === "") return "";
      var trimmed = path.replace(/[\\/]+$/, "");
      if (trimmed === "") return path;
      var parts = trimmed.split(/[\\/]/);
      return parts[parts.length - 1] || trimmed;
    }

    function sessionTitle(session, fallback) {
      if (session && typeof session.title === "string" && session.title.trim() !== "") return session.title;
      var project = session && typeof session.project === "string" && session.project !== "" ? session.project : "";
      if (project !== "") return project;
      var folder = session ? basename(session.cwd) : "";
      if (folder !== "") return folder;
      return typeof fallback === "string" ? fallback : "";
    }

    function isCjkText(value) {
      return typeof value === "string" && /[\u4e00-\u9fff]/.test(value);
    }

    /**
     * Text (and optional tooltip) for the "official peak/off-peak pricing" footnote.
     * The Host's `peakWindow` label is Chinese-only, so an English UI keeps its own
     * localized window copy visible and exposes the Host detail through the tooltip.
     */
    function pricingWindowNote(t, prices) {
      var source = prices || {};
      var peakWindow = typeof source.peakWindow === "string" ? source.peakWindow.trim() : "";
      if (peakWindow === "") return { text: t("timeAwareNote"), title: "" };
      var uiIsCjk = isCjkText(t("nav"));
      if (!uiIsCjk && isCjkText(peakWindow)) return { text: t("timeAwareNote"), title: peakWindow };
      return { text: t("timeAwareWindow", { window: peakWindow }), title: "" };
    }

    function csvCell(value) {
      if (value === undefined || value === null) return "";
      var text = String(value);
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      if (text.indexOf('"') !== -1 || text.indexOf(",") !== -1 || text.indexOf("\n") !== -1 || text.indexOf("\r") !== -1) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }

    const CSV_HEADER = [
      "sessionId",
      "title",
      "project",
      "model",
      "createdAt",
      "lastActivity",
      "requests",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
      "costUsd",
      "costCny",
    ];

    function buildCsv(summary) {
      var sessions = summary && Array.isArray(summary.sessions) ? summary.sessions : [];
      var lines = [CSV_HEADER.join(",")];
      for (var index = 0; index < sessions.length; index += 1) {
        var session = sessions[index] || {};
        var totals = session.totals || {};
        var row = [
          session.id,
          session.title,
          session.project,
          session.primaryModel,
          session.createdAt === undefined || session.createdAt === null ? "" : formatDateTimeSeconds(session.createdAt),
          session.lastActivity === undefined || session.lastActivity === null ? "" : formatDateTimeSeconds(session.lastActivity),
          totals.requests,
          totals.inputTokens,
          totals.outputTokens,
          totals.cacheReadTokens,
          totals.cacheWriteTokens,
          totals.totalTokens,
          session.costUsd,
          session.costCny,
        ];
        lines.push(row.map(csvCell).join(","));
      }
      return lines.join("\r\n") + "\r\n";
    }

    function csvFilename(value) {
      var date = value === undefined || value === null ? new Date() : getDate(value);
      return "token-stats-" + formatDayFromMs(date) + ".csv";
    }

    function normalizeDays(value) {
      var number = typeof value === "number" ? value : Number(value);
      if (number === 0) return 0;
      if (number === 7 || number === 30 || number === 90) return number;
      return 30;
    }

    function isSummaryEmpty(summary) {
      if (!summary) return true;
      var totals = summary.totals || {};
      var tokens = toFiniteNumber(totals.totalTokens);
      var requests = toFiniteNumber(totals.requests);
      var sessions = Array.isArray(summary.sessions) ? summary.sessions.length : 0;
      return tokens === 0 && requests === 0 && sessions === 0;
    }

    function messageOf(error) {
      if (error && typeof error.message === "string" && error.message !== "") return error.message;
      return String(error);
    }

    // ---------------------------------------------------------------------
    // Inline icons (no primitive exports needed; hook-free SVG)
    // ---------------------------------------------------------------------
    function TokenStatsInlineIcon(props) {
      var kind = props && props.kind;
      if (kind === "refresh") {
        return jsx("svg", {
          width: 12,
          height: 12,
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          children: jsx("path", {
            d: "M13.2 7.2a5.2 5.2 0 1 1-1.6-3.3M13.4 2.6v3.9H9.5",
            stroke: "currentColor",
            strokeWidth: 1.4,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        });
      }
      return jsx("svg", {
        width: 12,
        height: 12,
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": "true",
        children: [
          jsx("path", { d: "M8 2.2v8.4M4.8 7.4 8 10.6l3.2-3.2", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }),
          jsx("path", { d: "M2.8 13.2h10.4", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
        ],
      });
    }

    // ---------------------------------------------------------------------
    // Snapshot store + polling data controller
    // ---------------------------------------------------------------------
    const POLL_INTERVAL_MS = 30000;
    const STALE_AFTER_MS = 30000;

    function createInitialState() {
      return {
        days: 30,
        status: "idle",
        data: null,
        error: null,
        updatedAt: 0,
        lastFetchAt: 0,
        refreshing: false,
      };
    }

    function isDocumentHidden() {
      if (typeof document === "undefined") return false;
      if (document.visibilityState === "hidden") return true;
      return document.hidden === true;
    }

    function createStatsController(store, options) {
      var config = options || {};
      var pollMs = typeof config.pollMs === "number" ? config.pollMs : POLL_INTERVAL_MS;
      var clock = typeof config.now === "function" ? config.now : function () { return Date.now(); };
      var fetcher = typeof config.fetcher === "function"
        ? config.fetcher
        : typeof fetch === "function"
          ? function (url) { return fetch(url, { headers: { accept: "application/json" } }); }
          : null;
      var timer = null;
      var visibilityListener = null;
      var disposed = false;
      var pending = false;

      function request(force) {
        if (disposed) return Promise.resolve();
        if (pending) return Promise.resolve();
        var state = store.getSnapshot();
        var days = normalizeDays(state.days);
        var url = "api/token-stats.summary?days=" + encodeURIComponent(String(days)) + (force === true ? "&refresh=1" : "");
        pending = true;
        store.update(function (draft) {
          draft.status = draft.data === null || draft.data === undefined ? "loading" : "ready";
          draft.refreshing = true;
          draft.error = null;
        });
        var started;
        if (fetcher === null) {
          started = Promise.reject(new Error("fetch is not available"));
        } else {
          started = Promise.resolve().then(function () { return fetcher(url); });
        }
        return started
          .then(function (response) {
            if (disposed) return undefined;
            if (response && response.ok === false) {
              var status = response.status === undefined ? "" : " " + String(response.status);
              if (typeof response.text === "function") {
                return response.text().then(function (detail) {
                  var suffix = typeof detail === "string" && detail !== "" ? ": " + detail : "";
                  throw new Error("HTTP" + status + suffix);
                });
              }
              throw new Error("HTTP" + status);
            }
            if (response && typeof response.json === "function") return response.json();
            return response;
          })
          .then(function (payload) {
            if (disposed) return;
            if (!payload || typeof payload !== "object") throw new Error("invalid summary payload");
            var stamp = clock();
            store.update(function (draft) {
              draft.data = payload;
              draft.status = "ready";
              draft.refreshing = false;
              draft.error = null;
              draft.updatedAt = stamp;
              draft.lastFetchAt = stamp;
            });
          })
          .catch(function (error) {
            if (disposed) return;
            store.update(function (draft) {
              draft.refreshing = false;
              draft.error = messageOf(error);
              draft.status = draft.data === null || draft.data === undefined ? "error" : "ready";
            });
          })
          .then(function () {
            pending = false;
          });
      }

      function refresh(force) {
        return request(force === true);
      }

      function setDays(days) {
        var next = normalizeDays(days);
        if (store.getSnapshot().days !== next) {
          store.update(function (draft) { draft.days = next; });
        }
        return request(false);
      }

      function exportCsv() {
        var data = store.getSnapshot().data;
        if (!data) return "";
        var csv = buildCsv(data);
        try {
          if (typeof document !== "undefined" && typeof Blob === "function" && typeof document.createElement === "function") {
            var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
            var href = "";
            var objectUrl = null;
            if (typeof URL !== "undefined" && URL && typeof URL.createObjectURL === "function") {
              objectUrl = URL.createObjectURL(blob);
              href = objectUrl;
            }
            var anchor = document.createElement("a");
            if (anchor) {
              anchor.href = href;
              anchor.download = csvFilename(clock());
              anchor.rel = "noopener";
              if (typeof anchor.click === "function") anchor.click();
            }
            if (objectUrl !== null && typeof setTimeout === "function") {
              setTimeout(function () {
                try { if (typeof URL !== "undefined" && URL && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl); } catch (_error) { /* ignore */ }
              }, 1000);
            }
          }
        } catch (_error) {
          /* exporting is best effort; the returned CSV still exists in memory */
        }
        return csv;
      }

      function start() {
        if (disposed) return;
        request(false);
        if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
          visibilityListener = function () {
            if (!isDocumentHidden()) request(false);
          };
          document.addEventListener("visibilitychange", visibilityListener);
        }
        if (typeof setInterval === "function") {
          timer = setInterval(function () {
            if (disposed || isDocumentHidden()) return;
            request(false);
          }, pollMs);
        }
      }

      function dispose() {
        disposed = true;
        if (timer !== null && typeof clearInterval === "function") clearInterval(timer);
        timer = null;
        if (visibilityListener !== null && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", visibilityListener);
        }
        visibilityListener = null;
      }

      return {
        store: store,
        refresh: refresh,
        setDays: setDays,
        exportCsv: exportCsv,
        start: start,
        dispose: dispose,
      };
    }

    // ---------------------------------------------------------------------
    // Minimal synchronous renderer (preview + tests only; production uses React)
    // ---------------------------------------------------------------------
    var hooksRuntime = react;
    var hookFrames = [];
    var VOID_TAGS = { img: true, input: true, br: true, hr: true, meta: true, link: true, area: true, base: true, col: true, embed: true, source: true, track: true, wbr: true };

    function noop() {}

    function currentHookFrame() {
      if (hookFrames.length === 0) throw new Error("token-stats: hook called outside the preview renderer");
      return hookFrames[hookFrames.length - 1];
    }

    function createLiteHooks() {
      return {
        useState: function (initial) {
          var frame = currentHookFrame();
          var index = frame.index;
          frame.index += 1;
          if (!Object.prototype.hasOwnProperty.call(frame.values, index)) {
            frame.values[index] = typeof initial === "function" ? initial() : initial;
          }
          return [frame.values[index], noop];
        },
        useEffect: noop,
        useLayoutEffect: noop,
        useMemo: function (factory) { return factory(); },
        useCallback: function (callback) { return callback; },
        useRef: function (initial) {
          var frame = currentHookFrame();
          var index = frame.index;
          frame.index += 1;
          if (!Object.prototype.hasOwnProperty.call(frame.values, index)) frame.values[index] = { current: initial };
          return frame.values[index];
        },
        useId: function () {
          var frame = currentHookFrame();
          var index = frame.index;
          frame.index += 1;
          return "ts-preview-" + String(index);
        },
        useContext: function () { return undefined; },
        useSyncExternalStore: function (_subscribe, getSnapshot) { return getSnapshot(); },
      };
    }

    const liteHooks = createLiteHooks();

    function useHState(initial) {
      return hooksRuntime.useState(initial);
    }




    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function escapeAttribute(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function styleToCss(style) {
      if (!style || typeof style !== "object") return "";
      var parts = [];
      var keys = Object.keys(style);
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        var value = style[key];
        if (value === undefined || value === null || value === false) continue;
        var property = key.replace(/[A-Z]/g, function (letter) { return "-" + letter.toLowerCase(); });
        var text = typeof value === "number" ? String(value) + "px" : String(value);
        parts.push(property + ":" + text);
      }
      return parts.join(";");
    }


    const SVG_ATTRIBUTE_NAMES = {
      strokeWidth: "stroke-width",
      strokeLinecap: "stroke-linecap",
      strokeLinejoin: "stroke-linejoin",
      strokeDasharray: "stroke-dasharray",
      strokeDashoffset: "stroke-dashoffset",
      strokeOpacity: "stroke-opacity",
      fillOpacity: "fill-opacity",
      fillRule: "fill-rule",
      clipRule: "clip-rule",
    };

    function renderHostElement(tag, props) {
      var attributes = "";
      var keys = Object.keys(props);
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        if (key === "children" || key === "style" || key === "key" || key === "ref" || key === "dangerouslySetInnerHTML") continue;
        var value = props[key];
        if (value === undefined || value === null) continue;
        if (typeof value === "function" || typeof value === "object") continue;
        if (key.length > 2 && key.charAt(0) === "o" && key.charAt(1) === "n") continue;
        var name = key === "className" ? "class" : key === "htmlFor" ? "for" : SVG_ATTRIBUTE_NAMES[key] === undefined ? key : SVG_ATTRIBUTE_NAMES[key];
        var ariaOrData = key.indexOf("aria-") === 0 || key.indexOf("data-") === 0;
        if (value === true && !ariaOrData) {
          attributes += " " + name;
        } else if (value === false && !ariaOrData) {
          continue;
        } else {
          attributes += " " + name + '="' + escapeAttribute(value) + '"';
        }
      }
      var styleText = styleToCss(props.style);
      if (styleText !== "") attributes += ' style="' + escapeAttribute(styleText) + '"';
      if (VOID_TAGS[tag] === true) return "<" + tag + attributes + ">";
      return "<" + tag + attributes + ">" + renderNode(props.children) + "</" + tag + ">";
    }

    function callFunctionComponent(type, props) {
      var frame = { index: 0, values: {} };
      hookFrames.push(frame);
      try {
        return type(props === undefined || props === null ? {} : props);
      } finally {
        hookFrames.pop();
      }
    }

    function renderNode(node) {
      if (node === null || node === undefined || node === false || node === true) return "";
      var kind = typeof node;
      if (kind === "string") return escapeHtml(node);
      if (kind === "number") return String(node);
      if (kind !== "object") return "";
      if (Array.isArray(node)) {
        var buffer = "";
        for (var index = 0; index < node.length; index += 1) buffer += renderNode(node[index]);
        return buffer;
      }
      if (typeof Symbol !== "undefined" && node.$$typeof === Symbol.for("react.portal")) return renderNode(node.children);
      var type = node.type;
      var props = node.props || {};
      if (typeof type === "function") return renderNode(callFunctionComponent(type, props));
      if (typeof type === "symbol") return renderNode(props.children);
      if (type !== null && typeof type === "object") {
        if (typeof type.render === "function") return renderNode(callFunctionComponent(type.render, props));
        if (type.type !== undefined) return renderNode({ type: type.type, props: props });
        return "";
      }
      if (typeof type === "string") return renderHostElement(type, props);
      return "";
    }

    function renderToHtml(element) {
      var previous = hooksRuntime;
      hooksRuntime = liteHooks;
      try {
        return renderNode(element);
      } finally {
        hooksRuntime = previous;
        hookFrames = [];
      }
    }

    // ---------------------------------------------------------------------
    // UI components
    // ---------------------------------------------------------------------
    function readStats(props) {
      if (props && typeof props.useStats === "function") return props.useStats(function (snapshot) { return snapshot; });
      if (props && props.state !== undefined) return props.state;
      return createInitialState();
    }

    function RangeSwitcher(props) {
      var t = props.t;
      var days = props.days;
      var options = [
        { value: 7, label: t("range7") },
        { value: 30, label: t("range30") },
        { value: 90, label: t("range90") },
        { value: 0, label: t("rangeAll") },
      ];
      return jsx("div", {
        className: "ts_ranges",
        role: "tablist",
        "aria-label": t("title"),
        children: options.map(function (option) {
          var active = days === option.value;
          return jsx("button", {
            type: "button",
            role: "tab",
            className: "ts_rangeBtn",
            "aria-selected": active,
            "data-active": active ? "true" : "false",
            onClick: function () { if (typeof props.setDays === "function") props.setDays(option.value); },
            children: option.label,
          }, "range-" + String(option.value));
        }),
      });
    }

    function DashboardToolbar(props) {
      var t = props.t;
      var state = props.state || {};
      var updated = state.updatedAt > 0 ? t("updatedAt", { time: formatClock(state.updatedAt) }) : t("notUpdated");
      return jsxs("div", {
        className: "ts_toolbar",
        children: [
          jsx(RangeSwitcher, { t: t, days: state.days, setDays: props.setDays }),
          jsxs("div", {
            className: "ts_toolbarRight",
            children: [
              jsx("span", {
                className: "ts_updated",
                children: state.refreshing === true ? t("refreshing") : updated,
              }),
              jsx("button", {
                type: "button",
                className: "ts_btn",
                disabled: state.refreshing === true,
                onClick: function () { if (typeof props.refresh === "function") props.refresh(); },
                children: [
                  jsx("span", { className: "ts_footerIcon", children: jsx(TokenStatsInlineIcon, { kind: "refresh" }) }, "icon"),
                  jsx("span", { children: t("refresh") }),
                ],
              }),
              jsx("button", {
                type: "button",
                className: "ts_btn",
                disabled: state.data === null || state.data === undefined,
                onClick: function () { if (typeof props.exportCsv === "function") props.exportCsv(); },
                children: [
                  jsx("span", { className: "ts_footerIcon", children: jsx(TokenStatsInlineIcon, { kind: "download" }) }, "icon"),
                  jsx("span", { children: t("exportCsv") }),
                ],
              }),
            ],
          }),
        ],
      });
    }

    function MetricCard(props) {
      var t = props.t;
      var card = props.card;
      var totals = card.totals || {};
      var titleParts = [t("cnyApprox", { amount: formatCny(card.costCny) })];
      titleParts.push(formatInt(totals.requests) + " " + t("requestsUnit"));
      if (card.sessions !== undefined) titleParts.push(formatInt(card.sessions) + " " + t("sessionsUnit"));
      return jsxs("div", {
        className: "ts_metric",
        title: titleParts.join(" · "),
        children: [
          jsx("div", { className: "ts_metricLabel", children: card.label }),
          jsxs("div", {
            className: "ts_metricValue",
            children: [
              formatCompact(totals.totalTokens),
              jsx("span", { className: "ts_metricUnit", children: t("tokensUnit") }),
            ],
          }),
          jsxs("div", {
            className: "ts_metricSub",
            children: [
              jsx("span", { className: "ts_metricSubText", children: formatUsd(card.costUsd) }),
              jsx("span", { className: "ts_metricCny", children: t("cnyApprox", { amount: formatCny(card.costCny) }) }),
            ],
          }),
        ],
      });
    }

    function MetricCards(props) {
      var t = props.t;
      var data = props.data || {};
      var totals = data.totals || {};
      var today = data.today || {};
      var yesterday = data.yesterday || {};
      var last7 = data.last7Days || {};
      var cards = [
        { label: t("today"), totals: today.totals, costUsd: today.costUsd, costCny: today.costCny },
        { label: t("yesterday"), totals: yesterday.totals, costUsd: yesterday.costUsd, costCny: yesterday.costCny },
        { label: t("last7"), totals: last7.totals, costUsd: last7.costUsd, costCny: last7.costCny },
        { label: t("total"), totals: totals, costUsd: totals.costUsd, costCny: totals.costCny, sessions: totals.sessions },
      ];
      return jsx("div", {
        className: "ts_metrics",
        children: cards.map(function (card, index) {
          return jsx(MetricCard, { t: t, card: card }, "metric-" + String(index));
        }),
      });
    }

    function DailyChart(props) {
      var t = props.t;
      var daily = Array.isArray(props.daily) ? props.daily : [];
      var grouped = bucketDaily(daily);
      var buckets = grouped.buckets;
      if (buckets.length === 0) {
        return jsx("div", { className: "ts_state", children: t("noData") });
      }
      var max = 0;
      for (var index = 0; index < buckets.length; index += 1) {
        var value = toFiniteNumber(buckets[index].totals && buckets[index].totals.totalTokens);
        if (value > max) max = value;
      }
      var first = buckets[0];
      var last = buckets[buckets.length - 1];
      var unitKey = grouped.granularity === "week" ? "unitWeek" : grouped.granularity === "month" ? "unitMonth" : "unitDay";
      var title = t("chartTitle", { unit: t(unitKey) });
      return jsxs("div", {
        className: "ts_panel",
        children: [
          jsxs("div", {
            className: "ts_panelHead",
            children: [
              jsx("h3", { className: "ts_panelTitle", children: title }),
              jsx("span", { className: "ts_panelHint", children: t("chartHint") }),
            ],
          }),
          jsx("div", {
            className: "ts_chartScroll",
            "data-scroll": buckets.length > 60 ? "true" : "false",
            children: jsx("div", {
              className: "ts_chart",
              children: buckets.map(function (bucket, bucketIndex) {
                var totals = (bucket && bucket.totals) || {};
                var tokens = toFiniteNumber(totals.totalTokens);
                var costUsd = toFiniteNumber(bucket && bucket.costUsd);
                var costCny = toFiniteNumber(bucket && bucket.costCny);
                var tip = t("chartTip", {
                  day: bucketTipLabel(bucket, grouped.granularity),
                  tokens: formatCompact(tokens),
                  cost: formatUsd(costUsd),
                });
                return jsx("div", {
                  className: "ts_barWrap",
                  "data-zero": tokens === 0 ? "true" : "false",
                  "data-edge":
                    bucketIndex < Math.max(1, Math.ceil(buckets.length * 0.1))
                      ? "start"
                      : bucketIndex >= buckets.length - Math.max(1, Math.ceil(buckets.length * 0.1))
                        ? "end"
                        : undefined,
                  title: tip + " · " + t("cnyApprox", { amount: formatCny(costCny) }),
                  children: [
                    jsx("div", { className: "ts_bar", style: { height: barWidth(tokens, max) + "%" } }),
                    jsx("div", { className: "ts_barTip", children: tip }),
                  ],
                }, "bar-" + String(bucketIndex));
              }),
            }),
          }),
          jsxs("div", {
            className: "ts_chartAxis",
            children: [
              jsx("span", { children: bucketAxisLabel(first, grouped.granularity) }),
              jsx("span", { children: bucketAxisLabel(last, grouped.granularity) }),
            ],
          }),
        ],
      });
    }

    function ModelPanel(props) {
      var t = props.t;
      var models = Array.isArray(props.models) ? props.models : [];
      var shareMax = 1;
      var rows = models.map(function (model, index) {
        var key = model && model.key ? String(model.key) : "";
        var provider = model && model.provider ? String(model.provider) : "";
        var modelName = model && model.model ? String(model.model) : key;
        var share = toFiniteNumber(model && model.share);
        var costUsd = toFiniteNumber(model && model.costUsd);
        var costCny = toFiniteNumber(model && model.costCny);
        return jsxs("li", {
          className: "ts_row",
          children: [
            jsxs("div", {
              className: "ts_rowMain",
              children: [
                jsx("div", { className: "ts_rowName", children: modelName }),
                jsx("div", { className: "ts_rowSub", children: provider }),
              ],
            }),
            jsx("div", {
              className: "ts_track",
              children: jsx("div", { className: "ts_trackFill", style: trackFillStyle(share, shareMax) }),
            }),
            jsx("div", {
              className: "ts_rowValue",
              title: t("cnyApprox", { amount: formatCny(costCny) }),
              children: formatPercent(share) + " · " + formatUsd(costUsd),
            }),
          ],
        }, "model-" + String(index) + "-" + key);
      });
      return jsxs("div", {
        className: "ts_panel",
        children: [
          jsx("div", {
            className: "ts_panelHead",
            children: jsx("h3", { className: "ts_panelTitle", children: t("modelsTitle") }),
          }),
          rows.length === 0 ? jsx("div", { className: "ts_state", children: t("noData") }) : jsx("ul", { className: "ts_rows", children: rows }),
        ],
      });
    }

    function ProjectPanel(props) {
      var t = props.t;
      var projects = Array.isArray(props.projects) ? props.projects : [];
      var max = 0;
      for (var index = 0; index < projects.length; index += 1) {
        var projectTotals = projects[index] && projects[index].totals;
        var projectTokens = toFiniteNumber(projectTotals && projectTotals.totalTokens);
        if (projectTokens > max) max = projectTokens;
      }
      var rows = projects.map(function (project, projectIndex) {
        var totals = (project && project.totals) || {};
        return jsxs("li", {
          className: "ts_row",
          children: [
            jsxs("div", {
              className: "ts_rowMain",
              children: [
                jsx("div", { className: "ts_rowName", children: project && project.name ? String(project.name) : t("untitled") }),
                jsx("div", { className: "ts_rowSub", children: t("projectSessions", { count: formatInt(project && project.sessions) }) }),
              ],
            }),
            jsx("div", {
              className: "ts_track",
              children: jsx("div", { className: "ts_trackFill", style: trackFillStyle(totals.totalTokens, max) }),
            }),
            jsx("div", {
              className: "ts_rowValue",
              title: t("cnyApprox", { amount: formatCny(project && project.costCny) }),
              children: formatCompact(totals.totalTokens) + " · " + formatUsd(project && project.costUsd),
            }),
          ],
        }, "project-" + String(projectIndex));
      });
      return jsxs("div", {
        className: "ts_panel",
        children: [
          jsx("div", {
            className: "ts_panelHead",
            children: jsx("h3", { className: "ts_panelTitle", children: t("projectsTitle") }),
          }),
          rows.length === 0 ? jsx("div", { className: "ts_state", children: t("noData") }) : jsx("ul", { className: "ts_rows", children: rows }),
        ],
      });
    }

    const SESSION_PAGE_SIZE = 20;

    function SessionRow(props) {
      var t = props.t;
      var session = props.session || {};
      var totals = session.totals || {};
      var hasTitle = typeof session.title === "string" && session.title.trim() !== "";
      var title = sessionTitle(session, t("untitled"));
      var createdDay = !hasTitle && session.createdAt ? " · " + formatDayShort(session.createdAt) : "";
      var project = typeof session.project === "string" && session.project !== "" ? session.project : basename(session.cwd);
      var model = typeof session.primaryModel === "string" && session.primaryModel !== "" ? session.primaryModel : "";
      var subParts = [];
      if (hasTitle && project !== "") subParts.push(project);
      if (model !== "") subParts.push(model);
      return jsxs("li", {
        className: "ts_session",
        children: [
          jsxs("div", {
            className: "ts_sessionMain",
            children: [
              jsxs("div", {
                className: "ts_sessionTitle",
                children: [
                  session.live === true ? jsx("span", { className: "ts_liveDot", title: t("live") }) : null,
                  jsx("span", { className: "ts_sessionTitleText", title: title, children: title + createdDay }),
                  session.isSubagent === true ? jsx("span", { className: "ts_badge", children: t("subagent") }) : null,
                ],
              }),
              jsx("div", { className: "ts_sessionSub", children: subParts.join(" · ") }),
            ],
          }),
          jsx("div", {
            className: "ts_sessionNum",
            title: formatInt(totals.totalTokens),
            children: formatCompact(totals.totalTokens),
          }),
          jsx("div", {
            className: "ts_sessionCost",
            title: t("cnyApprox", { amount: formatCny(session.costCny) }),
            children: formatUsd(session.costUsd),
          }),
          jsx("div", {
            className: "ts_sessionTime",
            title: session.lastActivity ? formatDateTime(session.lastActivity) : undefined,
            children: session.lastActivity ? formatDayShort(session.lastActivity) : "—",
          }),
        ],
      }, "session-" + String(session.id === undefined ? "" : session.id) + "-" + String(props.index));
    }

    function SessionPanel(props) {
      var t = props.t;
      var sessions = Array.isArray(props.sessions) ? props.sessions : [];
      var expanded = props.expanded === true;
      var visible = expanded ? sessions : sessions.slice(0, SESSION_PAGE_SIZE);
      var rows = visible.map(function (session, index) {
        return jsx(SessionRow, { t: t, session: session, index: index }, "session-row-" + String(index));
      });
      var head = jsxs("li", {
        className: "ts_session ts_sessionHead",
        children: [
          jsx("div", { children: t("colSession") }),
          jsx("div", { className: "ts_sessionNum", children: t("colTokens") }),
          jsx("div", { className: "ts_sessionCost", children: t("colCost") }),
          jsx("div", { className: "ts_sessionTime", children: t("colLastActive") }),
        ],
      });
      return jsxs("div", {
        className: "ts_panel",
        children: [
          jsx("div", {
            className: "ts_panelHead",
            children: jsx("h3", { className: "ts_panelTitle", children: t("sessionsTitle") }),
          }),
          sessions.length === 0
            ? jsx("div", { className: "ts_state", children: t("noData") })
            : jsx("ul", { className: "ts_sessionList", children: [head].concat(rows) }),
          sessions.length > SESSION_PAGE_SIZE
            ? jsx("div", {
              className: "ts_more",
              children: jsx("button", {
                type: "button",
                className: "ts_btn",
                onClick: function () { props.setExpanded(expanded !== true); },
                children: expanded ? t("showLess") : t("showAllSessions", { count: formatInt(sessions.length) }),
              }),
            })
            : null,
        ],
      });
    }

    function HighlightsPanel(props) {
      var t = props.t;
      var data = props.data || {};
      var highlights = data.highlights || {};
      var busiest = highlights.busiestDay || null;
      var longest = highlights.longestSession || null;
      var items = [
        { label: t("streakLabel"), value: t("streakValue", { days: formatInt(highlights.streakDays) }), sub: "" },
        { label: t("cacheHitLabel"), value: formatPercent(highlights.cacheHitRate), sub: "" },
        {
          label: t("busiestLabel"),
          value: busiest && busiest.day ? formatDayShort(busiest.day) : "—",
          sub: busiest ? formatCompact(busiest.totalTokens) + " · " + formatUsd(busiest.costUsd) : "",
        },
        {
          label: t("longestLabel"),
          value: longest ? formatCompact(longest.totalTokens) : "—",
          sub: longest ? sessionTitle(longest, t("untitled")) : "",
        },
        { label: t("projectedLabel"), value: formatUsd(highlights.projectedMonthUsd), sub: "" },
      ];
      return jsxs("div", {
        className: "ts_highlightGroup",
        children: [
          jsx("h3", { className: "ts_groupHead", children: t("highlightsTitle") }),
          jsx("div", {
            className: "ts_highlights",
            children: items.map(function (item, index) {
              return jsxs("div", {
                className: "ts_highlight",
                children: [
                  jsx("div", { className: "ts_highlightLabel", children: item.label }),
                  jsx("div", { className: "ts_highlightValue", children: item.value }),
                  item.sub === "" ? null : jsx("div", { className: "ts_highlightSub", children: item.sub }),
                ],
              }, "highlight-" + String(index));
            }),
          }),
        ],
      });
    }

    function EmptyState(props) {
      return jsx("div", {
        className: "ts_panel",
        children: jsxs("div", {
          className: "ts_empty",
          children: [
            jsx("div", { className: "ts_emptyTitle", children: props.t("emptyTitle") }),
            jsx("div", { className: "ts_emptyHint", children: props.t("emptyHint") }),
          ],
        }),
      });
    }

    function ErrorState(props) {
      return jsxs("div", {
        className: "ts_error",
        role: "alert",
        children: [
          jsx("span", { className: "ts_errorText", children: props.t("errorTitle") + " — " + String(props.message) }),
          jsx("button", {
            type: "button",
            className: "ts_btn",
            onClick: function () { if (typeof props.retry === "function") props.retry(); },
            children: props.t("retry"),
          }),
        ],
      });
    }

    function Footnote(props) {
      var t = props.t;
      var data = props.data || {};
      var parts = [];
      if (data.generatedAt) parts.push(jsx("span", { children: t("generatedAt", { time: formatDateTime(data.generatedAt) }) }));
      if (data.timeZone) parts.push(jsx("span", { children: t("timeZoneLabel", { zone: data.timeZone }) }));
      var prices = data.prices || {};
      var unmatched = Array.isArray(prices.unmatchedModels) ? prices.unmatchedModels : [];
      if (unmatched.length > 0) {
        parts.push(jsx("span", {
          title: unmatched.join(", "),
          children: unmatched.length === 1
            ? t("pricesUnmatchedOne")
            : t("pricesUnmatched", { count: formatInt(unmatched.length) }),
        }));
      }
      if (prices.timeAware === true) {
        var note = pricingWindowNote(t, prices);
        parts.push(jsx("span", {
          className: "ts_timeAware",
          title: note.title === "" ? undefined : note.title,
          children: note.text,
        }));
      }
      if (parts.length === 0) return null;
      return jsx("div", { className: "ts_footnote", children: parts });
    }

    function DashboardBody(props) {
      var t = props.t;
      var state = props.state || {};
      var data = state.data === undefined ? null : state.data;
      var expandedState = useHState(false);
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];
      var children = [
        jsx(DashboardToolbar, {
          t: t,
          state: state,
          setDays: props.setDays,
          refresh: props.refresh,
          exportCsv: props.exportCsv,
        }, "toolbar"),
      ];
      if (state.error !== null && state.error !== undefined) {
        children.push(jsx(ErrorState, { t: t, message: state.error, retry: props.refresh }, "error"));
      }
      if (data === null) {
        if (state.error === null || state.error === undefined) {
          children.push(jsx("div", {
            className: "ts_panel",
            children: jsxs("div", {
              className: "ts_state",
              children: [
                jsx("span", { className: "ts_spinner", "aria-hidden": "true" }),
                jsx("span", { children: t("loading") }),
              ],
            }),
          }, "loading"));
        }
      } else if (isSummaryEmpty(data)) {
        children.push(jsx(EmptyState, { t: t }, "empty"));
      } else {
        children.push(jsx(MetricCards, { t: t, data: data }, "metrics"));
        children.push(jsx(DailyChart, { t: t, daily: data.daily }, "chart"));
        children.push(jsxs("div", {
          className: "ts_grid2",
          children: [
            jsx(ModelPanel, { t: t, models: data.byModel }, "models"),
            jsx(ProjectPanel, { t: t, projects: data.byProject }, "projects"),
          ],
        }, "grid"));
        children.push(jsx(SessionPanel, {
          t: t,
          sessions: data.sessions,
          expanded: expanded === true,
          setExpanded: setExpanded,
        }, "sessions"));
        children.push(jsx(HighlightsPanel, { t: t, data: data }, "highlights"));
        children.push(jsx(Footnote, { t: t, data: data }, "footnote"));
      }
      return jsx("div", { className: "ts_dash", children: children });
    }

    function TokenStatsSection(props) {
      var t = props.t;
      var state = readStats(props);
      return jsxs("section", {
        className: "ts_section",
        children: [
          jsx("h2", { className: "ts_title", children: t("title") }),
          jsx("p", { className: "ts_intro", children: t("intro") }),
          jsx(DashboardBody, {
            t: t,
            state: state,
            setDays: props.setDays,
            refresh: props.refresh,
            exportCsv: props.exportCsv,
          }),
        ],
      });
    }

    // Preview entry (test/acceptance only; never used by the live page)
    // ---------------------------------------------------------------------
    function previewSnapshot(summary, days) {
      return {
        days: normalizeDays(days),
        status: "ready",
        data: summary === undefined ? null : summary,
        error: null,
        updatedAt: summary && summary.generatedAt ? summary.generatedAt : 0,
        lastFetchAt: 0,
        refreshing: false,
      };
    }

    function buildPreviewProps(summary, options) {
      var config = options || {};
      var lang = config.locale === "en" ? "en" : "zh";
      var dictionary = lang === "en" ? en : zh;
      var days = summary && summary.range && summary.range.days !== undefined ? summary.range.days : 30;
      var state = previewSnapshot(summary, days);
      if (config.state !== undefined) state = config.state;
      return {
        t: function (key, params) {
          return formatText(dictionary[key] === undefined ? key : dictionary[key], params);
        },
        useStats: function (selector) { return selector(state); },
        setDays: noop,
        refresh: noop,
        exportCsv: noop,
        state: state,
      };
    }

    function previewHtml(summary, options) {
      var props = buildPreviewProps(summary === undefined ? null : summary, options);
      var html = renderToHtml(jsx(TokenStatsSection, props));
      return '<style data-plugin="dsh-plugin-token-stats" data-plugin-css="' + CSS_TAG_ID + '">' + CSS_TEXT + "</style>" +
        '<div class="ts_previewRoot">' + html + "</div>";
    }

    // ---------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------
    const inject = ["slots", "locale"];

    function apply(ctx) {
      const store = dsh_client_store.createSnapshotStore(createInitialState());
      const controller = createStatsController(store);

      ctx.effect(function () {
        controller.start();
        return function () { controller.dispose(); };
      }, "token-stats: polling");

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "token-stats: locale");

      const sectionFace = function () {
        return {
          hooks: { stats: store },
          setDays: function (days) { controller.setDays(days); },
          refresh: function () { controller.refresh(true); },
          exportCsv: function () { return controller.exportCsv(); },
        };
      };

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "token-stats",
          order: 45,
          label: function () { return ctx.locale.bind(NS)("nav"); },
          locale: NS,
          inject: sectionFace,
        }, TokenStatsSection);
      });

    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__test = {
      NS: NS,
      locales: { zh: zh, en: en },
      CSS_TEXT: CSS_TEXT,
      CSS_TAG_ID: CSS_TAG_ID,
      components: {
        TokenStatsSection: TokenStatsSection,
        DashboardBody: DashboardBody,
      },
      createInitialState: createInitialState,
      createStatsController: createStatsController,
      normalizeDays: normalizeDays,
      COLOR_TOKENS: COLOR_TOKENS,
      barColor: barColor,
      formatInt: formatInt,
      formatCompact: formatCompact,
      formatUsd: formatUsd,
      formatCny: formatCny,
      formatPercent: formatPercent,
      formatMoney: formatMoney,
      barWidth: barWidth,
      trackFillStyle: trackFillStyle,
      formatDayShort: formatDayShort,
      granularityFor: granularityFor,
      bucketDaily: bucketDaily,
      formatClock: formatClock,
      formatDateTime: formatDateTime,
      formatText: formatText,
      basename: basename,
      sessionTitle: sessionTitle,
      isCjkText: isCjkText,
      pricingWindowNote: pricingWindowNote,
      buildCsv: buildCsv,
      csvFilename: csvFilename,
      isSummaryEmpty: isSummaryEmpty,
      previewSnapshot: previewSnapshot,
      previewHtml: previewHtml,
      renderElement: function (element) { return renderToHtml(element); },
    };
    return module.exports;
  }
});

