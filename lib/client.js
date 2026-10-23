/**
 * dsh-liaobots-balance — browser half.
 *
 * Loads through the DSH client module loader and registers one seat in the
 * `sidebar.footer.action` slot: a sidebar footer card showing the remaining
 * Liaobots credits. Clicking it opens a portalled popover with the total
 * quota, threshold warnings and the most recent deductions.
 *
 * The card is a deliberate visual twin of dsh-balance-widget (same tokens,
 * metrics, compact-rail behaviour and popover animation) so the two cards sit
 * together in the sidebar without a seam; class names are namespaced
 * `dshlb_` and the brand label is `LB账户余额`.
 *
 * All data comes from the host half's loopback routes — the login code never
 * reaches the browser.
 */
window.__ModuleLoader__.load({
	id: "dsh-liaobots-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		/** Short alias for the element factory (this bundle has no JSX pass). */
		const e = React.createElement;
		const Fragment = React.Fragment;
		/**
		 * Glyph of the popover's refresh button. DSH renamed the product icons to
		 * size-neutral weights (`IconRefreshOutlineRegular` + `size`), and older
		 * hosts exported only the artboard-sized `IconRefreshOutline14`. Resolve
		 * once and fall back to a local glyph: rendering `undefined` as a
		 * component throws React #130, and the slot answers by dropping the card.
		 */
		const RefreshGlyph = [
			primitives.IconRefreshOutlineRegular,
			primitives.IconRefreshOutlineMedium,
			primitives.IconRefreshOutline14
		].find((glyph) => typeof glyph === "function" || (typeof glyph === "object" && glyph !== null));
		/** Refresh glyph element, stroke-matched to the card's own 16px icon. */
		function refreshGlyph() {
			if (RefreshGlyph !== void 0) return e(RefreshGlyph, { size: 14 });
			return e("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}, e("polyline", { points: "23 4 23 10 17 10" }), e("path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }));
		}
		//#region styles
		const css = ".dshlb_row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 0}"
			+ ".dshlb_label{display:inline-flex;align-items:center;min-width:0}"
			+ ".dshlb_val{font-weight:600;color:var(--dsw-alias-label-primary)}"
			+ ".dshlb_val[data-tier=\"sec\"]{font-weight:400;color:var(--dsw-alias-label-secondary)}"
			+ ".dshlb_val[data-level=\"1\"]{color:var(--dsw-alias-state-warn-primary)}"
			+ ".dshlb_val[data-level=\"2\"]{color:var(--dsw-alias-state-error-primary)}"
			+ ".dshlb_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;margin-top:6px}"
			+ ".dshlb_link{background:none;border:none;cursor:pointer;color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;font-size:12px;line-height:18px;font-family:inherit;text-decoration:none}"
			+ ".dshlb_link:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}"
			+ ".dshlb_sideTop{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;line-height:20px}"
			+ ".dshlb_sideAmount{font-weight:600}"
			+ ".dshlb_sideAmount[data-level=\"1\"]{color:var(--dsw-alias-state-warn-primary);font-weight:600}"
			+ ".dshlb_sideAmount[data-level=\"2\"]{color:var(--dsw-alias-state-error-primary)}"
			+ ".dshlb_sideFoot{display:flex;justify-content:space-between;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}"
			+ ".dshlb_sideWrap{position:relative;flex:1 1 auto;min-width:0}"
			// Stacked layout (default): the card claims a whole line of the
			// sidebar footer row and the row is told to wrap (see the layout
			// effect), so it sits under the DeepSeek balance card instead of
			// sharing its line. Kept before the compact rules so the collapsed
			// rail still shrinks the card to its icon size.
			+ ".dshlb_sideWrap[data-stack=\"true\"]{flex:1 1 100%}"
			+ ".dshlb_sideWrap[data-compact=\"true\"]{flex:0 0 auto}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_side{width:36px;height:36px;padding:0;margin:0;gap:0;justify-content:center;align-items:center;border-radius:var(--dsw-radius-md,10px);background:transparent;color:var(--dsw-alias-label-primary)}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_side:hover{background:var(--dsw-alias-interactive-bg-hover)}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_sideTop{justify-content:center;gap:0}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_sideAmount,.dshlb_sideWrap[data-compact=\"true\"] .dshlb_sideFoot{display:none}"
			+ ".dshlb_side{position:relative;display:flex;flex-direction:column;gap:4px;width:100%;padding:6px 8px;margin:0 0 2px;border:none;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;text-align:left;transition:transform 120ms cubic-bezier(0.23,1,0.32,1),background 120ms cubic-bezier(0.23,1,0.32,1)}"
			+ ".dshlb_side:active{transform:scale(.97)}"
			+ ".dshlb_side:hover{background:var(--dsw-alias-interactive-bg-active)}"
			+ ".dshlb_ico{color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center;gap:4px}"
			+ ".dshlb_sidePop{position:fixed;z-index:70;box-sizing:border-box;min-width:240px;max-width:calc(100vw - 16px);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 #0003,0 0 4px 0 #00000005,0 12px 32px 0 #00000014);padding:12px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);animation:dshlb-pop-in 160ms cubic-bezier(0.23,1,0.32,1) backwards}"
			+ ".dshlb_sidePopHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}"
			+ ".dshlb_sidePopTitle{font-weight:600}"
			+ ".dshlb_sidePopClose{background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;padding:0 2px;font-family:inherit}"
			+ ".dshlb_sidePopClose:hover{color:var(--dsw-alias-label-primary)}"
			+ ".dshlb_sidePopFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}"
			+ ".dshlb_sidePopRefresh{background:none;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;padding:0;font-family:inherit}"
			+ ".dshlb_sidePopRefresh:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}"
			+ ".dshlb_section{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}"
			+ ".dshlb_useRow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:18px;padding:1px 0;color:var(--dsw-alias-label-secondary)}"
			+ ".dshlb_useModel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}"
			+ ".dshlb_usePrice{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}"
			+ ".dshlb_useTime{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}"
			+ ".dshlb_hint{margin-top:6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);word-break:break-all}"
			+ ".dshlb_sym{font-size:1.3em;line-height:1}"
			+ ".dshlb_int{font-size:1.3em;line-height:1}"
			+ ".dshlb_dec{font-size:.8em}"
			+ ".dshlb_brand{white-space:nowrap;font-size:12.5px;line-height:1;font-weight:500}"
			+ ".dshlb_brandMini{display:none;white-space:nowrap;font-size:11px;line-height:1;font-weight:600}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_brand{display:none}"
			+ ".dshlb_sideWrap[data-compact=\"true\"] .dshlb_brandMini{display:inline}"
			+ ".dshlb_sidePopRefresh,.dshlb_sidePopClose{transition:transform 120ms cubic-bezier(0.23,1,0.32,1),color 120ms cubic-bezier(0.23,1,0.32,1)}"
			+ ".dshlb_sidePopRefresh:active{transform:scale(.92)}"
			+ ".dshlb_sidePopClose:active{transform:scale(.92)}"
			+ ".dshlb_side:focus-visible,.dshlb_link:focus-visible,.dshlb_sidePopClose:focus-visible,.dshlb_sidePopRefresh:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}"
			+ "@keyframes dshlb-pop-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}";
		const tagId = "dsh-liaobots-balance/styles.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-liaobots-balance";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const styles = {
			row: "dshlb_row",
			label: "dshlb_label",
			val: "dshlb_val",
			err: "dshlb_err",
			link: "dshlb_link",
			side: "dshlb_side",
			sideWrap: "dshlb_sideWrap",
			sideTop: "dshlb_sideTop",
			sideAmount: "dshlb_sideAmount",
			sideFoot: "dshlb_sideFoot",
			sidePop: "dshlb_sidePop",
			sidePopHead: "dshlb_sidePopHead",
			sidePopTitle: "dshlb_sidePopTitle",
			sidePopClose: "dshlb_sidePopClose",
			sidePopFoot: "dshlb_sidePopFoot",
			sidePopRefresh: "dshlb_sidePopRefresh",
			section: "dshlb_section",
			useRow: "dshlb_useRow",
			useModel: "dshlb_useModel",
			usePrice: "dshlb_usePrice",
			useTime: "dshlb_useTime",
			hint: "dshlb_hint"
		};
		//#endregion
		/** Format a credit amount: up to 4 decimals, trailing zeros dropped. */
		function formatCredits(value) {
			if (value === void 0 || value === null || !Number.isFinite(value)) return "—";
			const rounded = Math.round(value * 1e4) / 1e4;
			return rounded.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
		}
		/**
		 * Split an amount into "sign + integer (enlarged) + decimals (shrunk)".
		 * CSS cannot select a variable-length integer run, so the parts are
		 * wrapped here. Non-numeric text ("—", "…", "") is returned unchanged.
		 */
		function moneyNodes(text) {
			if (typeof text !== "string" || text === "") return text;
			const parts = /^([^\d]*)([\d,]+)(\.\d+)?$/.exec(text);
			if (parts === null) return text;
			const nodes = [];
			if (parts[1] !== "") nodes.push(e("span", { className: "dshlb_sym", key: "sym" }, parts[1]));
			nodes.push(e("span", { className: "dshlb_int", key: "int" }, parts[2]));
			if (parts[3] !== void 0) nodes.push(e("span", { className: "dshlb_dec", key: "dec" }, parts[3]));
			return nodes;
		}
		/** Compact local timestamp for a deduction row. */
		function formatTime(ms) {
			if (!Number.isFinite(ms)) return "";
			const date = new Date(ms);
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		//#region api
		/** Same-origin routes registered by the host half. */
		const BALANCE_ROUTE = "/api/dsh-liaobots/balance";
		const USAGE_ROUTE = "/api/dsh-liaobots/usage";
		/** Fallback refresh interval when the host sends none. */
		const DEFAULT_REFRESH_MS = 60000;
		/** Top-up page used when the host sends none. */
		const DEFAULT_TOP_UP_URL = "https://liaobots.work";
		/**
		 * Fetch the credit balance from the host proxy.
		 * @returns {Promise<object>} the host payload, or { ok: false, error }.
		 */
		async function fetchBalance() {
			try {
				const response = await fetch(BALANCE_ROUTE, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || payload.ok === false) {
					return { ok: false, error: payload.error ?? `余额接口返回 ${response.status}` };
				}
				return payload;
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		/**
		 * Fetch recent deductions from the host proxy.
		 * @param {number} pageSize - rows to ask for.
		 */
		async function fetchUsage(pageSize) {
			try {
				const response = await fetch(`${USAGE_ROUTE}?pageSize=${pageSize}`, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || payload.ok === false) {
					return { ok: false, error: payload.error ?? `用量接口返回 ${response.status}` };
				}
				return payload;
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		//#endregion
		//#region ExplainIcon
		/**
		 * A small ⓘ marker with a hover tooltip explaining a term. Wraps the
		 * official DSH Tooltip so the popover stays visually consistent.
		 */
		function ExplainIcon({ label, t }) {
			if (typeof primitives.Tooltip !== "function" && typeof primitives.Tooltip !== "object") return null;
			return e(primitives.Tooltip, {
				label,
				side: "top",
				delayMs: 300
			}, e("span", {
				role: "img",
				"aria-label": t("explain.aria"),
				style: { cursor: "help", color: "var(--dsw-alias-label-tertiary)", marginLeft: 3, fontSize: 11, lineHeight: 1 }
			}, e("span", null, "ⓘ")));
		}
		//#endregion
		//#region SidebarCreditsCard
		/** Recent deductions shown in the popover. */
		const USAGE_ROWS = 6;
		/**
		 * Sidebar footer card: remaining Liaobots credits, plus a popover with
		 * quota and the latest deductions.
		 * Root-scoped (global, not per-session) and refreshed on an interval.
		 * @param {Object} props - wide (sidebar expanded), t (locale).
		 */
		function SidebarCreditsCard({ wide, t }) {
			const [open, setOpen] = React.useState(false);
			const [balance, setBalance] = React.useState(null);
			const [amount, setAmount] = React.useState(null);
			const [usage, setUsage] = React.useState(null);
			const [host, setHost] = React.useState(null);
			const [lowThreshold, setLowThreshold] = React.useState(5);
			const [criticalThreshold, setCriticalThreshold] = React.useState(1);
			const [topUpURL, setTopUpURL] = React.useState(DEFAULT_TOP_UP_URL);
			const [error, setError] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
			/** Auto-refresh interval, decided by the host (`refreshIntervalMs`). */
			const [refreshMs, setRefreshMs] = React.useState(DEFAULT_REFRESH_MS);
			/**
			 * Stacked layout, decided by the host (`stackCards`): the sidebar
			 * footer slot is a flex row, so the card claims a whole line and the
			 * row wraps, putting it under the DeepSeek balance card.
			 */
			const [stack, setStack] = React.useState(true);
			/**
			 * Viewport position of the popover. The panel is portalled into
			 * document.body because the sidebar column clips its children
			 * (`overflow:hidden`), which would cut the panel off at the sidebar
			 * edge once the shell collapsed into its rail. Body still carries the
			 * theme tokens, so a portalled panel keeps its surface colors.
			 */
			const [popPos, setPopPos] = React.useState(null);
			/** Pull the recent deductions (only needed while the popover is open). */
			const refreshUsage = async () => {
				const result = await fetchUsage(USAGE_ROWS);
				if (result.ok === true) setUsage(result.usage ?? null);
				else setError(result.error ?? null);
			};
			/**
			 * Pull the balance, and optionally the recent deductions.
			 * @param {boolean} showLoading - show the loading placeholder.
			 * @param {boolean} withUsage - also fetch the deductions (popover open).
			 */
			const refresh = async (showLoading, withUsage) => {
				if (showLoading) setLoading(true);
				const result = await fetchBalance();
				if (result.ok === true) {
					setBalance(result.balance);
					setAmount(result.amount ?? null);
					setHost(result.host ?? null);
					if (typeof result.lowThreshold === "number") setLowThreshold(result.lowThreshold);
					if (typeof result.criticalThreshold === "number") setCriticalThreshold(result.criticalThreshold);
					if (typeof result.topUpURL === "string" && result.topUpURL !== "") setTopUpURL(result.topUpURL);
					if (typeof result.refreshIntervalMs === "number" && result.refreshIntervalMs >= 5000) {
						setRefreshMs(result.refreshIntervalMs);
					}
					if (typeof result.stackCards === "boolean") setStack(result.stackCards);
					setError(null);
					if (withUsage === true) await refreshUsage();
				} else {
					setError(result.error ?? "unknown balance error");
				}
				if (showLoading) setLoading(false);
			};
			React.useEffect(() => {
				refresh(false, false);
				const timer = setInterval(() => refresh(false, false), refreshMs);
				return () => clearInterval(timer);
			}, [refreshMs]);
			// Close the popover when clicking outside the card or its portalled panel.
			const wrapRef = React.useRef(null);
			const popRef = React.useRef(null);
			/**
			 * Let the sidebar footer row wrap, so a card that claims a whole
			 * line (`data-stack`) drops below its siblings instead of sharing
			 * the row. The row is shell-owned, so this is applied on its inline
			 * style (which outranks the shell stylesheet).
			 *
			 * The card's `parentElement` is NOT that row: DSH wraps slot entries
			 * in a `display: contents` outlet, which generates no box, so writing
			 * `flexWrap` there is silently ignored. Climb to the nearest ancestor
			 * that actually lays out as a flex row.
			 *
			 * Ownership instead of force, so two cards sharing the row never
			 * fight: whoever arrives first sets the value and remembers what was
			 * there; a later card sees "wrap" already set and stays out. Release
			 * only once nothing is left in the row - restoring while a neighbour
			 * is still mounted would squeeze that neighbour.
			 */
			React.useLayoutEffect(() => {
				if (stack !== true) return void 0;
				const el = wrapRef.current;
				if (el === null) return void 0;
				let row = el.parentElement;
				while (row !== null && row !== document.body) {
					const display = window.getComputedStyle(row).display;
					if (display === "flex" || display === "inline-flex") break;
					row = row.parentElement;
				}
				if (row === null || row === document.body) return void 0;
				// Refcounted on the row itself, so any number of cards can share it
				// without fighting: the first claimant records the inline value and
				// turns wrapping on, and the last one to leave puts it back. Unmount
				// order therefore cannot squeeze a neighbour that is still mounted.
				// The property name below is the cross-plugin contract - the DeepSeek
				// balance card keeps the same one.
				const state = row.__dshBalanceCardWrap || (row.__dshBalanceCardWrap = {
					count: 0,
					previous: row.style.flexWrap
				});
				state.count += 1;
				row.style.flexWrap = "wrap";
				return () => {
					state.count -= 1;
					if (state.count > 0) return;
					row.style.flexWrap = state.previous;
					delete row.__dshBalanceCardWrap;
				};
			}, [stack]);
			React.useEffect(() => {
				if (!open) return;
				const onDocClick = (event) => {
					const el = wrapRef.current;
					const panel = popRef.current;
					if (el !== null && el.contains(event.target)) return;
					if (panel !== null && panel.contains(event.target)) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", onDocClick);
				return () => document.removeEventListener("mousedown", onDocClick);
			}, [open]);
			/** Anchor the panel just above the card, kept inside the viewport. */
			const placePopover = () => {
				const el = wrapRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				// The panel matches the card it drops out of, so the two line up
				// whatever width the user gave the sidebar; 240px is the floor for
				// the collapsed rail, where the card is only 36px wide.
				const PANEL_MIN_WIDTH = 260;
				const width = Math.max(PANEL_MIN_WIDTH, Math.round(rect.width));
				setPopPos({
					left: Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8)),
					bottom: Math.max(8, Math.round(window.innerHeight - rect.top + 8)),
					width: Math.min(width, window.innerWidth - 16)
				});
			};
			// Keep the portalled panel glued to the card while the layout moves.
			React.useEffect(() => {
				if (!open) return;
				const reposition = () => placePopover();
				window.addEventListener("resize", reposition);
				const el = wrapRef.current;
				const observer = typeof ResizeObserver === "function" && el !== null ? new ResizeObserver(reposition) : null;
				if (observer !== null) observer.observe(el);
				return () => {
					window.removeEventListener("resize", reposition);
					if (observer !== null) observer.disconnect();
				};
			}, [open]);
			// Colour follows the remaining balance only, never a ratio: below
			// `criticalThreshold` (default 1) the amount turns red, below
			// `lowThreshold` (default 5) it turns yellow.
			const level = balance === null ? 0 : balance < criticalThreshold ? 2 : balance < lowThreshold ? 1 : 0;
			const toggle = async () => {
				const next = !open;
				if (next) placePopover();
				setOpen(next);
				if (next) await refresh(true, true);
			};
			/** Deduction rows for the popover. */
			const usageRows = usage !== null && Array.isArray(usage.list)
				? usage.list.slice(0, USAGE_ROWS).map((entry, index) => e("div", {
					className: styles.useRow,
					key: entry.id ?? `row-${index}`
				},
					e("span", { className: styles.useModel, title: entry.model }, entry.model !== "" ? entry.model : "—"),
					e("span", { className: styles.usePrice }, entry.price !== null ? `-${formatCredits(entry.price)}` : "—"),
					e("span", { className: styles.useTime }, formatTime(entry.createdAt))
				))
				: [];
			return e("div", {
				ref: wrapRef,
				className: styles.sideWrap,
				// "data-stack" makes the card claim a whole line of the footer
				// row (see the layout effect). The sidebar shell hands the slot a
				// `wide` flag: collapsed, the foot becomes a 56px icon rail, so
				// "data-compact" shrinks the card to one glyph.
				"data-stack": stack === true ? "true" : void 0,
				"data-compact": wide === false ? "true" : void 0
			},
				e("button", {
					type: "button",
					className: styles.side,
					title: t("title"),
					onClick: toggle
				},
					e("div", { className: styles.sideTop },
						e("span", { className: "dshlb_ico" },
							e("span", { className: "dshlb_brand", key: "f" }, t("brand")),
							e("span", { className: "dshlb_brandMini", key: "s" }, "LB")
						),
						e("span", {
							className: styles.sideAmount,
							"data-level": level > 0 ? level : void 0
						}, balance !== null ? moneyNodes(formatCredits(balance)) : "—")
					),
					e("div", { className: styles.sideFoot },
						e("span", null, t("amountShort")),
						e("span", null, amount !== null ? moneyNodes(formatCredits(amount)) : "—")
					)
				),
				open && popPos !== null && ReactDOM.createPortal(e("div", {
					ref: popRef,
					className: styles.sidePop,
					role: "dialog",
					style: { left: popPos.left, bottom: popPos.bottom, width: popPos.width }
				},
					e("div", { className: styles.sidePopHead },
						e("span", { className: styles.sidePopTitle }, t("title")),
						e("button", {
							type: "button",
							className: styles.sidePopClose,
							"aria-label": t("close"),
							onClick: () => setOpen(false)
						}, "×")
					),
					e("div", { className: styles.row },
						e("span", { className: styles.label },
							t("balance"),
							e(ExplainIcon, { label: t("explain.balance"), t })
						),
						e("span", {
							className: styles.val,
							"data-level": level > 0 ? level : void 0
						}, loading ? "…" : balance !== null ? formatCredits(balance) : "—")
					),
					e("div", { className: styles.row },
						e("span", { className: styles.label },
							t("amount"),
							e(ExplainIcon, { label: t("explain.amount"), t })
						),
						e("span", { className: styles.val, "data-tier": "sec" }, loading ? "…" : amount !== null ? formatCredits(amount) : "—")
					),
					level > 0 && e("div", { className: styles.err, role: "status" }, t(`warn.text.${level}`)),
					e("div", { className: styles.section }, e("span", null, t("usage.title"))),
					usageRows.length > 0 ? usageRows : e("div", { className: styles.useRow },
						e("span", { className: styles.useModel }, loading ? t("usage.loading") : t("usage.empty"))
					),
					error !== null && e("div", { className: styles.err, role: "status" }, error),
					host !== null && e("div", { className: styles.hint }, `${t("gateway")}: ${host}/api/v1/credits`),
					e("div", { className: styles.sidePopFoot },
						e("a", {
							className: styles.link,
							href: topUpURL,
							target: "_blank",
							rel: "noreferrer"
						}, t("topUp")),
						e("button", {
							type: "button",
							className: styles.sidePopRefresh,
							"aria-label": t("refresh.aria"),
							title: t("refresh.title"),
							onClick: () => refresh(true, true)
						}, refreshGlyph())
					)
				), document.body)
			);
		}
		//#endregion
		//#region locales
		/** Dictionary namespace owned by this plugin. */
		const NS = "liaobots-balance";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"aria": "查看 Liaobots 余额",
			"title": "Liaobots 余额",
			"brand": "LB账户余额",
			"refresh.aria": "刷新数据",
			"refresh.title": "刷新余额与扣费记录",
			"balance": "剩余积分",
			"amount": "总积分",
			"amountShort": "总积分",
			"explain.aria": "解释",
			"explain.balance": "Liaobots 网关 GET /api/v1/credits 返回的 data.balance，即当前剩余可用积分。",
			"explain.amount": "同一接口的 data.amount，即账户累计总额度。",
			"usage.title": "最近扣费",
			"usage.empty": "暂无扣费记录",
			"usage.loading": "正在读取…",
			"gateway": "数据来源",
			"warn.text.1": "⚠️ 剩余积分偏低，建议及时充值。",
			"warn.text.2": "⛔ 剩余积分即将耗尽，请立即充值！",
			"topUp": "去充值",
			"close": "关闭"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"aria": "View Liaobots credits",
			"title": "Liaobots credits",
			"brand": "LB credits",
			"refresh.aria": "Refresh data",
			"refresh.title": "Refresh credits and deductions",
			"balance": "Remaining credits",
			"amount": "Total quota",
			"amountShort": "Total",
			"explain.aria": "Explain",
			"explain.balance": "data.balance from the Liaobots gateway GET /api/v1/credits: the credits left on the account.",
			"explain.amount": "data.amount from the same endpoint: the total quota granted to the account.",
			"usage.title": "Recent deductions",
			"usage.empty": "No deductions yet",
			"usage.loading": "Loading…",
			"gateway": "Source",
			"warn.text.1": "⚠️ Credits running low, consider topping up.",
			"warn.text.2": "⛔ Credits almost exhausted — top up now!",
			"topUp": "Top up",
			"close": "Close"
		};
		//#endregion
		//#region client plugin
		/** Required services: the seat's slot registry and locale registry. */
		const inject = ["slots", "locale"];
		/**
		 * Client plugin body: register the sidebar footer credits card next to
		 * the DeepSeek balance card (which seats itself at order 10).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-liaobots-balance: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "liaobots-balance",
				order: 20,
				locale: NS
			}, SidebarCreditsCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.SidebarCreditsCard = SidebarCreditsCard;
		return module.exports;
	}
});
