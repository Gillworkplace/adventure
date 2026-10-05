import { dialog, confirmAction } from "./dialogs.js";
import { showDiagnostics } from "./diagnostics.js";
function helpSteps() {
  const alternate = new URLSearchParams(location.search).get("CtrlYn")?.toUpperCase() === "Y";
  const vela = document.querySelector("#settings-button").dataset.model === "vela";
  const keys = alternate ? ["1", "2", "3"] : ["Ctrl+Q", "Ctrl+E", "Ctrl+G"];
  return [
    ["游戏模式", "#mode-button",
      "<strong>辅助</strong>模式会从连接的游戏画面读取位置·骰子·卡牌，并反映到推荐中。实际游戏请自行操作。",
      "<strong>手动</strong>模式需要亲自输入实际游戏的位置·骰子·卡牌。",
      "<strong>本地试玩</strong>模式在应用内按实际游戏规则直接游玩，不会代替你操作实际游戏。",
      "从中间开始连接时，请打开实际游戏的<strong>卡牌获取记录</strong>，并从上到下慢慢滚动。新游戏会直接开始；若检测到牌堆重置或有遗漏的操作，会请求再次确认。",
      "难以读取的数值可通过<strong>顶部提示中的手动输入</strong>补正。确认期间推荐会暂时暂停。",
      "选择推荐模型后，可在顶部<strong>语音</strong>中开启语音引导。可在韩语·英语·日语·中文以及女声·男声中选择使用。下载语音前可确认大小，也支持在浏览器中保存和删除。",
      "通过<strong>切换模式</strong>转换后，最后确认的状态仍会保留。要结束辅助模式的画面连接，请断开连接或切换到其他模式。"],
    ["位置与关卡移动", "#position-button",
      `点击当前<strong>格编号</strong>即可输入位置。手动模式快捷键为 <kbd>${keys[0]}</kbd>。`,
      `手动模式下可以<strong>拖动角色</strong>改变位置。<strong>关卡箭头</strong>${alternate ? "" : "·方向键 ←/→"}可在手动·本地试玩模式下改变位置。`],
    ["骰子与双骰", "#roll-button",
      "<strong>手动</strong>模式下用骰子按钮切换是否双骰，并用<strong>+2~+12</strong>输入掷出的点数之和。",
      "<strong>本地试玩</strong>模式下点击骰子按钮掷出两颗骰子。如果是双骰，下一次掷骰不消耗次数。",
      `点击<strong>骰子使用次数</strong>可进行修改。手动模式快捷键为 <kbd>${keys[1]}</kbd>。`],
    ...(vela ? [["各行动评估与推荐", "#estimates",
      "<strong>评估值越高，选择越有利</strong>。推荐是评估值最高的选择，并非最终分数预测。",
      "将鼠标悬停在列表上可比较各行动的数值。点击或按 <kbd>Ctrl+R</kbd> 重新计算。",
      "小屏幕上请点击<strong>比较</strong>按钮。触屏上长按列表也可打开。",
      "<strong>模型选择</strong>可更换模型。"]] : [["各行动分数与推荐", "#estimates",
      "这是对每个选择之后进行模拟得到的<strong>最终分数平均值</strong>。“推荐”是平均分最高的选择，“接近”是与推荐差距不明显的选择。",
      "各行动分数是用来比较选择的数值，会随 G3 推荐每次重新计算，与持续采用推荐时的预期最终分数不同。",
      "将鼠标悬停在分数列表上会打开整体比较表。点击列表或按 <kbd>Ctrl+R</kbd> 重新计算。",
      "小屏幕上请点击<strong>比较</strong>按钮。触屏上长按列表也可打开。",
      "<strong>模型选择</strong>可更换模型·计算方式。",
      { label: "统计说明", html: '<dl class="help-reference"><dt>样本数</dt><dd>对该选择进行模拟的次数</dd><dt>平均 / 中位数</dt><dd>平均值是所有结果的平均，中位数是把结果排序后位于中间的值。比较表中的代表值，GPU 用平均值、CPU 用中位数，而推荐两者都以平均值为准。</dd><dt>范围</dt><dd>模拟中出现的最低~最高分数</dd><dt>95% 置信区间</dt><dd>表示平均估计的不确定性，并不意味着一局的分数会落在这个区间内。</dd></dl>' }]]),
    ["预期最终分数", "#score-forecast",
      `这是在当前状态下<strong>持续采用 ${vela ? "VELA" : "G3-R100K"} 推荐时</strong>的最终分数预测。不保证实际结果，且与各行动评估分开计算。`,
      "括号内是相对上一状态的变化。直接修改位置·卡牌等也会改变该数值，因此并不只代表单次行动的效果。",
      "游戏结束后会显示实际最终分数。无法预测时显示为 <strong>—</strong>。"],
    ["卡牌的使用与添加", "#hand",
      "<strong>点击卡牌即可使用</strong>。也可用 <kbd>Ctrl+1~5</kbd> 选择对应槽位。",
      "<strong>右键点击可直接弃置，不产生移动。</strong>触屏上请长按后选择“弃置”。",
      "手动模式下，<strong>倍数卡牌需选择实际骰子点数之和(2~12)</strong>后使用。可点击数字按钮，或输入后按 <kbd>Enter</kbd> 应用；按 <kbd>Esc</kbd> 或取消可返回。",
      `手动模式下可通过<strong>空槽位</strong>或 <kbd>${keys[2]}</kbd> 搜索并添加卡牌。本地试玩模式下会在卡牌获取格抽取。`,
      { label: "卡牌搜索示例", html: '<dl class="help-reference"><dt>名称片段</dt><dd>用卡牌名称中包含的文字搜索</dd><dt>+10 或 10</dt><dd>前进 10 格</dd><dt>-5</dt><dd>后退 5 格</dd><dt>*2</dt><dd>骰子 2 倍</dd><dt>&gt;</dt><dd>下一关卡</dd></dl>' }],
    ["到达预览", "#roll-button",
      "棋盘上会显示<strong>各到达位置的概率</strong>。多个骰子结果到达同一位置时，概率会合并。",
      "将鼠标悬停在骰子或卡牌上，可查看卡牌格·跳跃格·停留格的概率。当前关卡的到达位置会显示在棋盘上。",
      "触屏上请长按骰子，或长按卡牌后选择<strong>到达预测</strong>。"],
    ["全部卡牌与获取标记", "#card-info-button",
      "用<strong>?</strong>按钮打开和关闭全部卡牌列表。",
      "手动模式下，点击列表中的卡牌可切换获取标记；右键点击或长按可将其加入手牌。",
      "仅切换获取标记不会改变手牌；加入手牌后获取标记也会一并更新。本地试玩模式下只能取消获取标记。"],
    ["重新开始", "#reset-button",
      "点击<strong>重新开始</strong>并确认后，位置·骰子·卡牌将被重置。本页面保持打开期间的最高纪录会保留。",
      "如果操作有疑问，可在<strong>帮助</strong>中再次确认。"],
  ].map(([title, target, ...content]) => ({
    title, target,
    paragraphs: content.filter((item) => typeof item === "string"),
    detail: content.find((item) => typeof item === "object"),
  }));
}
export function showHelp() {
  const steps = helpSteps();
  if (document.querySelector("dialog")) return;
  let index = 0,
    drag = null,
    confirming = false;
  const body = document.createElement("div");
  body.innerHTML =
    '<div class="help-spotlight" aria-hidden="true"></div><section class="help-bubble"><div class="help-arrow" aria-hidden="true"></div><header class="help-title"><span class="help-progress"></span><h3></h3></header><div class="help-content"><div class="help-copy"></div><button type="button" data-nav="detail" class="help-more" aria-controls="help-extra" aria-expanded="false" hidden>详情</button><div id="help-extra" class="help-extra" hidden></div></div><footer><button data-nav="close" class="help-skip">跳过</button><span></span><button data-nav="back" aria-label="上一步">上一步</button><button data-nav="next" class="primary">下一步</button></footer><div class="help-support"><span>遇到问题了吗？</span><button type="button" class="help-diagnostics">保存诊断信息</button></div></section>';
  const node = dialog("Adventure 使用指南", body, { className: "help-tour" }),
    bubble = body.querySelector(".help-bubble"),
    spot = body.querySelector(".help-spotlight"),
    extra = body.querySelector(".help-extra"),
    arrow = body.querySelector(".help-arrow");
  body.querySelector(".help-diagnostics").onclick = () =>
    showDiagnostics({ onSaved: () => node.close() });
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function place() {
    const target = document.querySelector(steps[index].target),
      r = target?.getBoundingClientRect(),
      w = bubble.offsetWidth,
      h = bubble.offsetHeight;
    spot.hidden = !r;
    if (r)
      Object.assign(spot.style, {
        left: r.left - 5 + "px",
        top: r.top - 5 + "px",
        width: r.width + 10 + "px",
        height: r.height + 10 + "px",
      });
    let x = (innerWidth - w) / 2,
      y = (innerHeight - h) / 2,
      side = "none";
    if (r) {
      if (r.right + 22 + w <= innerWidth - 12) {
        x = r.right + 22;
        y = r.top;
        side = "left";
      } else if (r.left - 22 - w >= 12) {
        x = r.left - 22 - w;
        y = r.top;
        side = "right";
      } else {
        x = r.left + (r.width - w) / 2;
        y = r.top - h - 22;
        side = "bottom";
        if (y < 12) {
          y = r.bottom + 22;
          side = "top";
        }
      }
    }
    x = clamp(x, 12, innerWidth - w - 12);
    y = clamp(y, 12, innerHeight - h - 12);
    Object.assign(bubble.style, { left: x + "px", top: y + "px" });
    arrow.dataset.side = side;
    if (r) {
      arrow.style.setProperty(
        "--arrow-x",
        clamp(r.left + r.width / 2 - x, 20, w - 20) + "px",
      );
      arrow.style.setProperty(
        "--arrow-y",
        clamp(r.top + r.height / 2 - y, 20, h - 20) + "px",
      );
    }
  }
  function render() {
    const { title, paragraphs, detail } = steps[index];
    bubble.querySelector("h3").textContent = title;
    bubble.querySelector(".help-copy").innerHTML = paragraphs.map((line) => `<p>${line}</p>`).join("");
    bubble.querySelector(".help-progress").textContent = `${index + 1} / ${steps.length}`;
    extra.innerHTML = detail?.html ?? "";
    extra.hidden = true;
    bubble.querySelector(".help-content").scrollTop = 0;
    const more = bubble.querySelector("[data-nav=detail]");
    more.hidden = !detail;
    more.textContent = detail?.label ?? "";
    more.setAttribute("aria-expanded", "false");
    bubble.querySelector("[data-nav=back]").disabled = index === 0;
    bubble.querySelector("[data-nav=next]").textContent =
      index === steps.length - 1 ? "完成" : "下一步";
    place();
  }
  async function exit() {
    if (confirming) return;
    confirming = true;
    const close = await confirmAction(
      "结束帮助",
      "要结束帮助吗？随时可以通过帮助按钮重新打开。",
    );
    confirming = false;
    if (close) node.close();
  }
  node.addEventListener("cancel", (e) => {
    e.preventDefault();
    exit();
  });
  body.onclick = (e) => {
    const nav = e.target.closest("[data-nav]")?.dataset.nav;
    if (nav === "close") exit();
    else if (nav === "detail") {
      extra.hidden = !extra.hidden;
      e.target.setAttribute("aria-expanded", String(!extra.hidden));
      e.target.textContent = extra.hidden ? steps[index].detail.label : "收起说明";
      place();
    } else if (nav === "next") {
      if (index === steps.length - 1) node.close();
      else {
        index++;
        render();
      }
    } else if (nav === "back" && index) {
      index--;
      render();
    }
  };
  const heading = body.querySelector(".help-title");
  heading.onpointerdown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const r = bubble.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    heading.setPointerCapture(e.pointerId);
  };
  heading.onpointermove = (e) => {
    if (!drag) return;
    arrow.dataset.side = "none";
    bubble.style.left =
      clamp(
        drag.left + e.clientX - drag.x,
        12,
        innerWidth - bubble.offsetWidth - 12,
      ) + "px";
    bubble.style.top =
      clamp(
        drag.top + e.clientY - drag.y,
        12,
        innerHeight - bubble.offsetHeight - 12,
      ) + "px";
  };
  heading.onpointerup = heading.onpointercancel = () => (drag = null);
  window.addEventListener("resize", place);
  node.addEventListener(
    "close",
    () => window.removeEventListener("resize", place),
    { once: true },
  );
  render();
  bubble.querySelector("[data-nav=next]").focus({ preventScroll: true });
  return node;
}
