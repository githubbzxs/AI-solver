/*
  鍓嶇涓婚€昏緫锛?
  - 澶勭悊鏂囧瓧/鍥剧墖杈撳叆涓庨瑙?
  - 绠＄悊鍓创鏉跨矘璐翠笌澶嶅埗
  - 璋冪敤鍚庣 /api/solve 骞舵覆鏌撶瓟妗?
  - 璁板綍鍘嗗彶涓庣敤閲忕粺璁?
*/

// ===== 椤甸潰鍏冪礌寮曠敤锛堥泦涓幏鍙栵紝閬垮厤閲嶅鏌ヨ锛?=====
const form = document.getElementById("solve-form");
const promptInput = document.getElementById("prompt");
const imageInput = document.getElementById("image");
const fileName = document.getElementById("fileName");
const dropzone = document.getElementById("dropzone");
const dropzoneEmpty = document.getElementById("dropzoneEmpty");
const dropzonePreview = document.getElementById("dropzonePreview");
const imagePreviewList = document.getElementById("imagePreviewList");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusTag = document.getElementById("status");
const answerBox = document.getElementById("answer");
const errorBox = document.getElementById("error");
const errorToggle = document.getElementById("errorToggle");
const errorDetails = document.getElementById("errorDetails");
const submitBtn = document.getElementById("submitBtn");
const spinner = document.getElementById("spinner");
const copyBtn = document.getElementById("copyBtn");
const pasteBtn = document.getElementById("pasteBtn");
const notice = document.getElementById("notice");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyToggle = document.getElementById("historyToggle");
const settingsToggle = document.getElementById("settingsToggle");
const historyModal = document.getElementById("historyModal");
const settingsModal = document.getElementById("settingsModal");

// localStorage 鐨勫瓧娈靛悕闆嗕腑绠＄悊
const STORAGE = {
  usage: "gemini_usage",
  history: "gemini_history",
};

// 内置 Key 标签，仅用于前端统计展示
const INTERNAL_KEY_LABEL = "内置Key";

const setStatus = (text, isLoading) => {
  statusTag.textContent = text;
  statusTag.classList.toggle("loading", Boolean(isLoading));
};

// 鎺у埗鍔犺浇鍔ㄧ敾涓庢寜閽鐢?
const setLoading = (isLoading) => {
  spinner.hidden = !isLoading;
  submitBtn.disabled = isLoading;
};

// toast 閫氱煡鐨勫畾鏃跺櫒鍙ユ焺
let noticeTimer = null;

// 鏄剧ず鐭殏鎻愮ず锛屽苟鍦ㄨ秴鏃跺悗鑷姩闅愯棌
const showNotice = (text, tone = "default") => {
  if (!notice) return;
  notice.textContent = text;
  notice.dataset.tone = tone;
  notice.hidden = false;
  notice.classList.add("is-visible");
  if (noticeTimer) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.classList.remove("is-visible");
    window.setTimeout(() => {
      notice.hidden = true;
    }, 220);
  }, 2000);
};

// 浣跨敤 KaTeX 鑷姩娓叉煋鍏紡锛堟敮鎸佸父瑙佹暟瀛﹀垎闅旂锛?
const renderMath = (element) => {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  });
};

// 浣跨敤 marked 娓叉煋 Markdown锛涙棤搴撴椂鍥為€€涓哄畨鍏ㄦ枃鏈?
const renderMarkdown = (text) => {
  if (window.marked) {
    return window.marked.parse(text, { breaks: true });
  }
  return text.replace(/[&<>"]/g, (ch) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return map[ch] || ch;
  });
};

// 绮樿创/閫夋嫨鍗曞紶鍥剧墖鏃剁殑蹇嵎澶勭悊
const applyImageFile = (file) => {
  if (!file) return false;
  setSelectedImages([file], { replace: false, announce: "宸茬矘璐村浘鐗? });
  return true;
};

// 鍦ㄨ緭鍏ユ鍏夋爣浣嶇疆鎻掑叆鏂囨湰锛屽苟淇濇寔鍏夋爣浣嶇疆姝ｇ‘
const insertAtCursor = (el, text) => {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = before + text + after;
  const next = start + text.length;
  el.selectionStart = next;
  el.selectionEnd = next;
  el.focus();
};

// 澶勭悊绮樿创鏂囨湰锛氳嫢杈撳叆妗嗕负绌哄垯鐩存帴濉叆锛屽惁鍒欒拷鍔犲埌鍏夋爣澶?
const applyPaste = (text) => {
  if (!text) return;
  if (!promptInput.value.trim()) {
    promptInput.value = text;
    promptInput.focus();
    showNotice("宸茬矘璐?);
    return;
  }

  const prefix = promptInput.value.endsWith("\n") || text.startsWith("\n") ? "" : "\n";
  insertAtCursor(promptInput, prefix + text);
  showNotice("宸茬矘璐?);
};

// 浠?localStorage 璇诲彇鍘嗗彶璁板綍
const loadHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE.history);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

// 淇濆瓨鍘嗗彶璁板綍鍒?localStorage
const saveHistory = (items) => {
  localStorage.setItem(STORAGE.history, JSON.stringify(items));
};

// 褰撳墠棰勮鍥句笌宸查€夋嫨鍥剧墖锛堜粎鍦ㄥ唴瀛樹腑缁存姢锛?
let previewUrls = [];
let selectedImages = [];

// 閲婃斁 ObjectURL锛岄伩鍏嶅唴瀛樻硠闇?
const clearPreviewUrls = () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
};

// 灏嗗唴瀛樹腑鐨勫浘鐗囧悓姝ュ洖 <input type="file">锛堥儴鍒嗘祻瑙堝櫒鍙兘鍙楅檺锛?
const syncImageInput = () => {
  try {
    const transfer = new DataTransfer();
    selectedImages.forEach((file) => transfer.items.add(file));
    imageInput.files = transfer.files;
  } catch (error) {
    // Some browsers block programmatic file assignment.
  }
};

// 璁剧疆/杩藉姞鍥剧墖鍒楄〃锛屽苟鍒锋柊棰勮涓庢彁绀?
const setSelectedImages = (files, { replace = false, announce = "" } = {}) => {
  const images = Array.from(files || []).filter(
    (file) => file && file.type && file.type.startsWith("image/")
  );
  if (images.length === 0) {
    if (announce) showNotice(announce, "error");
    return;
  }
  selectedImages = replace ? images : [...selectedImages, ...images];
  syncImageInput();
  updateDropzone();
  if (announce) showNotice(announce);
};

// 鎸夌储寮曠Щ闄ゅ浘鐗?
const removeImageAt = (index) => {
  if (!Number.isFinite(index)) return;
  selectedImages = selectedImages.filter((_, idx) => idx !== index);
  syncImageInput();
  updateDropzone();
};

// 鏍规嵁褰撳墠鍥剧墖鍒楄〃鍒锋柊涓婁紶鍖哄煙涓庣缉鐣ュ浘棰勮
const updateDropzone = () => {
  const files = selectedImages;
  clearPreviewUrls();

  // 娌℃湁鍥剧墖鏃舵樉绀衡€滅┖鐘舵€佲€?
  if (!files.length) {
    dropzoneEmpty.hidden = false;
    dropzonePreview.hidden = true;
    fileName.textContent = "鏈€夋嫨鍥剧墖";
    if (imagePreviewList) imagePreviewList.innerHTML = "";
    return;
  }

  // 鏈夊浘鐗囨椂灞曠ず棰勮鍒楄〃
  dropzoneEmpty.hidden = true;
  dropzonePreview.hidden = false;
  fileName.textContent = `宸查€夋嫨 ${files.length} 寮犲浘鐗嘸;

  if (!imagePreviewList) return;
  imagePreviewList.innerHTML = "";

  // 涓烘瘡寮犲浘鐗囧垱寤虹缉鐣ュ浘涓庡垹闄ゆ寜閽?
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const item = document.createElement("div");
    item.className = "preview-item";

    const img = document.createElement("img");
    img.src = url;
    img.alt = `宸蹭笂浼犲浘鐗囷細${file.name}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preview-remove";
    remove.dataset.index = String(index);
    remove.setAttribute("aria-label", "绉婚櫎鍥剧墖");
    remove.textContent = "脳";

    item.appendChild(img);
    item.appendChild(remove);
    imagePreviewList.appendChild(item);
  });
};

// 娓叉煋鍘嗗彶璁板綍鍒楄〃锛堜娇鐢?<details> 灞曞紑/鎶樺彔锛?
const renderHistory = () => {
  const items = loadHistory();
  historyList.innerHTML = "";
  // 绌哄垪琛ㄦ椂缁欎竴涓崰浣嶆彁绀?
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "鏆傛棤璁板綍";
    historyList.appendChild(empty);
    return;
  }

  // 浣跨敤 <details>/<summary> 璁╂瘡鏉¤褰曞彲灞曞紑
  items.forEach((item) => {
    const card = document.createElement("details");
    card.className = "history-item";

    const summary = document.createElement("summary");
    summary.className = "history-summary";

    const summaryLeft = document.createElement("span");
    summaryLeft.textContent = `${item.time} 路 ${item.model || "gemini-3-flash-preview"}`;

    const summaryRight = document.createElement("span");
    summaryRight.className = "history-open";
    summaryRight.textContent = "鏌ョ湅璇︽儏";

    summary.appendChild(summaryLeft);
    summary.appendChild(summaryRight);

    const prompt = document.createElement("div");
    prompt.className = "history-block";
    prompt.textContent = `棰樼洰锛?{item.prompt || "锛堟棤鏂囨湰锛?}`;

    const answer = document.createElement("div");
    answer.className = "history-block";
    answer.textContent = `绛旀锛?{item.answer || "锛堟棤鍥炵瓟锛?}`;

    card.appendChild(summary);
    const imageNames = Array.isArray(item.imageName)
      ? item.imageName
      : item.imageName
      ? [item.imageName]
      : [];
    if (imageNames.length) {
      const img = document.createElement("div");
      img.className = "history-meta";
      img.textContent = `鍥剧墖锛?{imageNames.join("銆?)}`;
      card.appendChild(img);
    }
    card.appendChild(prompt);
    card.appendChild(answer);
    historyList.appendChild(card);
  });

  renderMath(historyList);
};

// 鏂板涓€鏉″巻鍙茶褰曪紝骞堕檺鍒舵€绘暟閲?
const addHistory = ({ prompt, answer, model, imageName }) => {
  const items = loadHistory();
  // 浣跨敤鏈湴鏃堕棿瀛楃涓蹭究浜庣敤鎴烽槄璇?
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  const entry = {
    id: Date.now(),
    time,
    prompt,
    answer,
    model,
    imageName,
  };
  // 鏈€鏂扮殑鏀惧湪鏈€鍓嶏紝鏈€澶氫繚鐣?20 鏉?
  const updated = [entry, ...items].slice(0, 20);
  saveHistory(updated);
  renderHistory();
};

// 璁板綍鐢ㄩ噺锛氭寜澶┿€佹寜 Key 姹囨€伙紝渚夸簬璁剧疆椤靛睍绀?
const recordUsage = (usage) => {
  const now = new Date();
  // 浠ユ棩鏈燂紙YYYY-MM-DD锛変綔涓哄瓨鍌?key锛屼究浜庢寜澶╃粺璁?
  const dayKey = now.toISOString().slice(0, 10);
  // API 杩斿洖缁撴瀯鍙兘涓嶅悓锛岃繖閲屽吋瀹规€?token 鎴栨媶鍒?token
  const totalTokens =
    usage?.totalTokenCount ||
    (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

  // 璇诲彇宸叉湁鐢ㄩ噺鏁版嵁锛堝潖鏁版嵁鍒欏洖閫€涓虹┖瀵硅薄锛?
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORAGE.usage) || "{}");
  } catch (error) {
    store = {};
  }

  // 鍒濆鍖栧綋澶╃粺璁＄粨鏋?
  const today = store[dayKey] || { requests: 0, tokens: 0, perKey: {} };
  today.requests += 1;
  today.tokens += totalTokens || 0;

  // 鎸?Key 鍐嶇粏鍒嗙粺璁★紙Key 浣跨敤鑴辨晱褰㈠紡锛?
  const label = INTERNAL_KEY_LABEL;
  const perKey = today.perKey[label] || { requests: 0, tokens: 0 };
  perKey.requests += 1;
  perKey.tokens += totalTokens || 0;
  today.perKey[label] = perKey;

  // 鍐欏洖 localStorage
  store[dayKey] = today;
  localStorage.setItem(STORAGE.usage, JSON.stringify(store));
};

// 閫夋嫨鏂囦欢鍚庯紝鍒锋柊鍥剧墖鍒楄〃
imageInput.addEventListener("change", () => {
  setSelectedImages(imageInput.files, { replace: true });
});

// 鐐瑰嚮/閿洏瑙﹀彂涓婁紶锛堝彲璁块棶鎬э細Enter/绌烘牸锛?
dropzone.addEventListener("click", (event) => {
  if (event.target.closest("#removeImageBtn")) return;
  if (event.target.closest(".preview-remove")) return;
  imageInput.click();
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  imageInput.click();
});

// 娓呯┖鎵€鏈夊凡閫夊浘鐗?
removeImageBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  selectedImages = [];
  syncImageInput();
  updateDropzone();
});

// 缂╃暐鍥句笂鐨勨€溍椻€濅娇鐢ㄤ簨浠跺鎵?
if (imagePreviewList) {
  imagePreviewList.addEventListener("click", (event) => {
    const button = event.target.closest(".preview-remove");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number.parseInt(button.dataset.index || "", 10);
    if (Number.isNaN(index)) return;
    removeImageAt(index);
  });
}

// 涓€閿矘璐达細浼樺厛璇诲彇鍥剧墖锛屽叾娆¤鍙栨枃鏈?
pasteBtn.addEventListener("click", async () => {
  let handledImage = false;
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      const imageFiles = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        imageFiles.push(new File([blob], "clipboard-image.png", { type: blob.type }));
      }
      if (imageFiles.length) {
        setSelectedImages(imageFiles, {
          replace: false,
          announce: `宸茬矘璐?${imageFiles.length} 寮犲浘鐗嘸,
        });
        handledImage = true;
      }
    } catch (error) {
      handledImage = false;
    }
  }

  if (handledImage) return;

  if (!navigator.clipboard?.readText) {
    showNotice("娴忚鍣ㄤ笉鏀寔涓€閿矘璐达紝璇烽暱鎸夎緭鍏ユ绮樿创", "error");
    promptInput.focus();
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      promptInput.focus();
      return;
    }
    applyPaste(text);
  } catch (error) {
    promptInput.focus();
    showNotice("鏃犳硶璇诲彇鍓创鏉匡紝璇烽暱鎸夎緭鍏ユ绮樿创", "error");
  }
});

// 澶嶅埗绛旀鍒板壀璐存澘
copyBtn.addEventListener("click", async () => {
  const text = answerBox.textContent.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showNotice("宸插鍒?);
  } catch (error) {
    showNotice("澶嶅埗澶辫触", "error");
  }
});

// 娓呯┖鍘嗗彶璁板綍
clearHistoryBtn.addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

// 灞曞紑/鏀惰捣閿欒璇︽儏
errorToggle.addEventListener("click", () => {
  const isHidden = errorDetails.hidden;
  errorDetails.hidden = !isHidden;
  errorToggle.textContent = isHidden ? "闅愯棌璇︽儏" : "鏌ョ湅璇︽儏";
});

// 鎵撳紑寮圭獥锛氱鐢ㄩ〉闈㈡粴鍔?
const openModal = (modal) => {
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
};

// 鍏抽棴寮圭獥锛氭仮澶嶉〉闈㈡粴鍔?
const closeModal = (modal) => {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
};

// 椤堕儴鎸夐挳鎵撳紑寮圭獥
historyToggle.addEventListener("click", () => {
  openModal(historyModal);
});

settingsToggle.addEventListener("click", () => {
  openModal(settingsModal);
});

// 鍏佽鍏朵粬鍏ュ彛鎵撳紑璁剧疆寮圭獥锛堜緥濡傛彁绀烘寜閽級
document.querySelectorAll("[data-open=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openModal(settingsModal);
  });
});

// 鐐瑰嚮閬僵鎴栧叧闂寜閽叧闂脊绐?
document.querySelectorAll("[data-close=\"history\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(historyModal));
});

document.querySelectorAll("[data-close=\"settings\"]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(settingsModal));
});

// ESC 蹇嵎閿叧闂脊绐?
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeModal(historyModal);
  closeModal(settingsModal);
});

// 椤甸潰鍒濆鍖栵細鏇存柊妯″瀷鎻愮ず/鍘嗗彶/涓婁紶鍖?
document.addEventListener("DOMContentLoaded", () => {
  renderHistory();
  updateDropzone();
});

// 鐩戝惉绯荤粺绮樿创浜嬩欢锛氳嫢鏄浘鐗囧垯鐩存帴鍔犲叆棰勮
document.addEventListener("paste", (event) => {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const items = Array.from(clipboard.items || []);
  const imageItems = items
    .filter((item) => item.type && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imageItems.length) {
    event.preventDefault();
    setSelectedImages(imageItems, {
      replace: false,
      announce: `宸茬矘璐?${imageItems.length} 寮犲浘鐗嘸,
    });
    return;
  }
  const files = Array.from(clipboard.files || []).filter(
    (file) => file.type && file.type.startsWith("image/")
  );
  if (!files.length) return;
  event.preventDefault();
  setSelectedImages(files, {
    replace: false,
    announce: `宸茬矘璐?${files.length} 寮犲浘鐗嘸,
  });
});

// 涓绘祦绋嬶細鎻愪氦棰樼洰 -> 璇锋眰鍚庣 -> 娓叉煋绛旀/璁板綍鍘嗗彶
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  errorDetails.textContent = "";
  errorDetails.hidden = true;
  errorToggle.textContent = "鏌ョ湅璇︽儏";
  const prompt = promptInput.value.trim();
  const files = selectedImages;

  // 鏍￠獙锛氳嚦灏戞湁鏂囧瓧鎴栧浘鐗?
  if (!prompt && files.length === 0) {
    errorDetails.textContent = "璇峰～鍐欓鐩垨涓婁紶鍥剧墖銆?;
    errorDetails.hidden = true;
    errorToggle.textContent = "鏌ョ湅璇︽儏";
    errorBox.hidden = false;
    return;
  }
  // 缁勮 multipart/form-data 鍙戦€佺粰鍚庣
  const formData = new FormData();
  if (prompt) formData.append("prompt", prompt);
  files.forEach((file) => {
    formData.append("image", file);
  });

  // UI 杩涘叆鍔犺浇鐘舵€?
  setLoading(true);
  answerBox.textContent = "姝ｅ湪瑙ｇ瓟锛岃绋嶅€?..";
  setStatus("澶勭悊涓?, true);

  try {
    // 璇锋眰鍚庣鎺ュ彛锛堢敱鍚庣鍐嶈浆鍙戠粰 Gemini锛?
    const response = await fetch("/api/solve", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    // HTTP 闈?2xx 鏃舵姏鍑洪敊璇紝杩涘叆 catch
    if (!response.ok) {
      throw new Error(data.error || "璇锋眰澶辫触銆?);
    }

    // 姝ｅ父杩斿洖锛氭覆鏌?Markdown + 鍏紡锛屽苟璁板綍鍘嗗彶/鐢ㄩ噺
    const answerText = data.answer || "鏆傛棤杩斿洖鍐呭銆?;
    answerBox.innerHTML = renderMarkdown(answerText);
    renderMath(answerBox);
    recordUsage(data.usage);
    addHistory({
      prompt,
      answer: data.answer,
      model: data.model,
      imageName: files.length ? files.map((file) => file.name) : [],
    });
    setStatus("瀹屾垚", false);
  } catch (error) {
    answerBox.textContent = "鏆傛棤绛旀銆?;
    errorDetails.textContent = error.message;
    errorDetails.hidden = true;
    errorToggle.textContent = "鏌ョ湅璇︽儏";
    errorBox.hidden = false;
    setStatus("閿欒", false);
  } finally {
    setLoading(false);
  }
});





