var AHTCM_TIME_SLOTS = [
  { number: 1,  startTime: '08:30', endTime: '09:10' },
  { number: 2,  startTime: '09:20', endTime: '10:00' },
  { number: 3,  startTime: '10:10', endTime: '10:50' },
  { number: 4,  startTime: '11:00', endTime: '11:40' },
  { number: 5,  startTime: '14:00', endTime: '14:40' },
  { number: 6,  startTime: '14:50', endTime: '15:30' },
  { number: 7,  startTime: '15:40', endTime: '16:20' },
  { number: 8,  startTime: '16:30', endTime: '17:10' },
  { number: 9,  startTime: '17:20', endTime: '18:00' },
  { number: 10, startTime: '18:00', endTime: '18:40' },
  { number: 11, startTime: '19:00', endTime: '19:40' },
  { number: 12, startTime: '19:50', endTime: '20:30' },
  { number: 13, startTime: '20:40', endTime: '21:20' },
  { number: 14, startTime: '21:30', endTime: '22:10' }
];

var API_TABLE = '/new/student/xsgrkb/getCalendarWeekDatas';
var API_WEEK_DATES = '/new/xlxx/getDatesOfWeek';

var TAG = '[AHTCM]';

// ---------------------------------------------------------------------------
// 桥接封装：存在性判断 + 降级 + 原生返回值归一化
// ---------------------------------------------------------------------------
function toast(message) {
  if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
    window.shiguangBridge.showToast(message);
  } else {
    console.log(TAG + ' ' + message);
  }
}

function errorMessageOf(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  try {
    var serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch (_) {
    // 忽略序列化失败，走通用兜底
  }
  return '未知错误';
}

async function alertUser(title, message, confirmText) {
  if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function')) {
    console.log(TAG + ' [降级 alert] ' + title + ': ' + message);
    return true;
  }
  try {
    var confirmed = await window.shiguangBridgePromise.showAlert(title, message, confirmText || '确定');
    return confirmed === true || confirmed === 'true';
  } catch (error) {
    console.log(TAG + ' showAlert 失败: ' + errorMessageOf(error));
    return false;
  }
}

/** 单选列表弹窗，返回选中索引；取消返回 -1 */
async function selectFromList(title, items, defaultIndex) {
  if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showSingleSelection === 'function')) {
    return typeof defaultIndex === 'number' ? defaultIndex : 0;
  }
  try {
    var r = await window.shiguangBridgePromise.showSingleSelection(
      title,
      JSON.stringify(items),
      typeof defaultIndex === 'number' ? defaultIndex : -1
    );
    if (r === null || r === undefined || r === 'null') return -1;
    if (typeof r === 'number') return r;
    var n = parseInt(r, 10);
    return isNaN(n) ? -1 : n;
  } catch (error) {
    console.log(TAG + ' showSingleSelection 失败: ' + errorMessageOf(error));
    return -1;
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 周次数组规范化：去重 + 升序 */
function normalizeWeeks(weeks) {
  if (!Array.isArray(weeks)) return [];
  var seen = {};
  var out = [];
  for (var i = 0; i < weeks.length; i++) {
    var w = weeks[i];
    if (!seen[w]) { seen[w] = true; out.push(w); }
  }
  return out.sort(function (a, b) { return a - b; });
}

/**
 * 教师名规范化：拆分 → 去重（保持首次出现顺序）→ 用半角逗号重连。
 *
 * 为什么要去重：安中医的 teaxms 是**按上课场次**拼出来的列表，
 * 同一教师上多个场次就会重复出现。实测真实值：
 *   "徐志鹏,欧阳婷,欧阳婷,徐志鹏" → "徐志鹏,欧阳婷"
 * 去重后保持首次出现顺序（不排序），以保留「第一位为主讲」的语义。
 *
 * 缺失时返回空字符串 ""（遵循规范 §6.1：无则传 ""，不编造占位名）。
 */
function cleanTeacher(value) {
  var s = cleanText(value);
  if (!s) return '';
  var parts = s.split(/[,，、;；]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    if (seen[p]) continue;
    seen[p] = true;
    out.push(p);
  }
  return out.join(',');
}

/** 文本规范化：去首尾空白；缺失时返回 ""（不编造占位文本） */
function cleanText(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * 解析周次字符串。乘方实际下发的是逗号分隔的纯数字（且无序），
 * 这里额外兼容区间与单双周写法，遇到无法识别的片段只跳过该片段。
 */
function parseWeeks(weekStr) {
  if (weekStr === null || weekStr === undefined) return [];
  var str = String(weekStr);
  if (!str.trim()) return [];

  var parity = 0; // 1=单周 2=双周
  if (str.indexOf('双') !== -1) parity = 2;
  else if (str.indexOf('单') !== -1) parity = 1;

  var cleaned = str
    .replace(/第/g, '')
    .replace(/至|到/g, '-')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/周/g, '');

  var weeks = [];
  var segments = cleaned.split(/[,，、;；\s]+/);
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    if (!seg) continue;
    var range = seg.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
    if (range) {
      var a = parseInt(range[1], 10);
      var b = parseInt(range[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      for (var w = a; w <= b; w++) weeks.push(w);
    } else {
      var single = parseInt(seg, 10);
      if (!isNaN(single) && single > 0) weeks.push(single);
    }
  }

  if (parity === 1) {
    weeks = weeks.filter(function (x) { return x % 2 === 1; });
  } else if (parity === 2) {
    weeks = weeks.filter(function (x) { return x % 2 === 0; });
  }
  return normalizeWeeks(weeks);
}

/**
 * 官方《课程合并与去重函数》（阶段一合并连续节次与完全重复；阶段二合并同节次周次）。
 * 与官方片段的差异：官方在 courses.length <= 1 时直接原样返回（不做周次规范化），
 * 这里改为仅对空数组提前返回，保证 weeks 始终升序去重。
 */
function mergeAndDistinctCourses(courses) {
  if (!Array.isArray(courses) || courses.length === 0) return courses;

  var list = courses.map(function (c) {
    return {
      name: c.name || '',
      teacher: c.teacher || '',
      position: c.position || '',
      day: c.day,
      startSection: c.startSection,
      endSection: c.endSection,
      weeks: normalizeWeeks(c.weeks),
      isCustomTime: c.isCustomTime,
      customStartTime: c.customStartTime,
      customEndTime: c.customEndTime,
      credit: c.credit
    };
  });

  // 阶段 1：合并连续节次与完全重复记录
  list.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name)) ||
      String(a.teacher).localeCompare(String(b.teacher)) ||
      String(a.position).localeCompare(String(b.position)) ||
      (a.day || 0) - (b.day || 0) ||
      a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
      (a.startSection || 0) - (b.startSection || 0);
  });

  var step1Merged = [];
  var current = list[0];
  for (var i = 1; i < list.length; i++) {
    var next = list[i];
    var sameCourseAndWeeks = current.name === next.name &&
      current.teacher === next.teacher &&
      current.position === next.position &&
      current.day === next.day &&
      current.weeks.join(',') === next.weeks.join(',');
    var isContinuous = current.endSection + 1 === next.startSection;
    var isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

    if (sameCourseAndWeeks && isContinuous) {
      current.endSection = next.endSection;
    } else if (sameCourseAndWeeks && isDuplicate) {
      continue;
    } else {
      step1Merged.push(current);
      current = next;
    }
  }
  step1Merged.push(current);

  // 阶段 2：合并同节次的周次
  step1Merged.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name)) ||
      String(a.teacher).localeCompare(String(b.teacher)) ||
      String(a.position).localeCompare(String(b.position)) ||
      (a.day || 0) - (b.day || 0) ||
      (a.startSection || 0) - (b.startSection || 0) ||
      (a.endSection || 0) - (b.endSection || 0);
  });

  var step2Merged = [];
  var cur = step1Merged[0];
  for (var j = 1; j < step1Merged.length; j++) {
    var nxt = step1Merged[j];
    var sameCourseAndSection = cur.name === nxt.name &&
      cur.teacher === nxt.teacher &&
      cur.position === nxt.position &&
      cur.day === nxt.day &&
      cur.startSection === nxt.startSection &&
      cur.endSection === nxt.endSection;

    if (sameCourseAndSection) {
      cur.weeks = normalizeWeeks(cur.weeks.concat(nxt.weeks));
    } else {
      step2Merged.push(cur);
      cur = nxt;
    }
  }
  step2Merged.push(cur);

  return step2Merged;
}

// ---------------------------------------------------------------------------
// 网络
// ---------------------------------------------------------------------------

/**
 * 递归遍历同源 document。
 *
 * 为什么必须递归：实测课表页的结构是**两层嵌套 iframe**
 *   顶层 welcome.page → iframe(我的课表/班级课表) → iframe(工具条 + 课表)
 * 而 #xnxqdm 在最内层。适配脚本被注入到哪一层并不确定，
 * 所以从当前 document 起向下递归查找，任一层的 #xnxqdm 都能命中。
 */
function walkDocuments(doc, callback, depth) {
  if (!doc || depth > 3) return;
  callback(doc);
  var frames;
  try {
    frames = doc.getElementsByTagName('iframe');
  } catch (_) {
    return;
  }
  if (!frames) return;
  for (var i = 0; i < frames.length; i++) {
    var child = null;
    try {
      child = frames[i].contentDocument;
    } catch (_) {
      child = null; // 跨域帧忽略
    }
    if (child) walkDocuments(child, callback, depth + 1);
  }
}

function eachSameOriginDocument(callback) {
  walkDocuments(document, callback, 0);
}

/**
 * 收集学期列表。
 * 优先读课表页的 <select id="xnxqdm">（权威列表），取不到时按当前日期推算。
 * @returns {Array<{value:string,label:string,selected:boolean}>}
 */
function collectSemesters() {
  var collected = [];
  eachSameOriginDocument(function (doc) {
    if (collected.length) return;
    var sel = doc.getElementById('xnxqdm');
    if (!sel) return;
    var opts = sel.getElementsByTagName('option');
    for (var i = 0; i < opts.length; i++) {
      var value = String(opts[i].getAttribute('value') || opts[i].value || '').trim();
      if (!value) continue;
      collected.push({
        value: value,
        label: labelOfSemester(value),
        selected: !!opts[i].selected
      });
    }
  });

  if (collected.length) return collected;
  return fallbackSemesters();
}

/** "202601" -> "2026-2027学年第1学期"；解析失败则原样返回 */
function labelOfSemester(value) {
  var m = String(value).match(/^(\d{4})(\d{2})$/);
  if (!m) return String(value);
  var year = parseInt(m[1], 10);
  var term = parseInt(m[2], 10);
  return year + '-' + (year + 1) + '学年第' + term + '学期';
}

/** DOM 取不到时的回退：按当前日期推算最近 6 个学年 */
function fallbackSemesters() {
  var now = new Date();
  var y = now.getFullYear();
  var month = now.getMonth() + 1;
  // 8 月及以后视为新学年秋季学期
  var startYear = month >= 8 ? y : (month >= 2 ? y - 1 : y - 1);
  var out = [];
  for (var k = 0; k < 6; k++) {
    var yy = startYear - k;
    out.push({ value: String(yy) + '01', label: labelOfSemester(String(yy) + '01'), selected: k === 0 });
    out.push({ value: String(yy) + '02', label: labelOfSemester(String(yy) + '02'), selected: false });
  }
  return out;
}

/** POST 表单，返回解析后的 JSON */
async function postForm(path, params) {
  var body = new URLSearchParams();
  for (var key in params) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    body.append(key, params[key] === null || params[key] === undefined ? '' : params[key]);
  }
  var response = await fetch(window.location.origin + path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body.toString()
  });
  if (!response.ok) throw new Error('接口请求失败（HTTP ' + response.status + '）');
  return response.json();
}

/** 把 Date 格式化为接口要求的 "YYYY-MM-DD HH:mm:ss" */
function formatDateTime(date) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
    ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds());
}

/**
 * 取指定学期的开学日期（第 1 周周一）。
 * 失败不影响主流程，返回 null。
 */
async function fetchSemesterStartDate(xnxqdm) {
  try {
    var rows = await postForm(API_WEEK_DATES, { xnxqdm: xnxqdm, zc: 1 });
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].xqmc) === '1' && rows[i].rq) {
        var rq = String(rows[i].rq).split(' ')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(rq)) return rq;
      }
    }
    return null;
  } catch (error) {
    console.log(TAG + ' 获取开学日期失败（不影响导入）: ' + errorMessageOf(error));
    return null;
  }
}

/**
 * 拉取并解析指定学期的全部课程。
 * zc 传空字符串 = 全部周次；d1/d2 给一个足够宽的区间，避免日历视图窗口截断数据。
 */
async function fetchCourses(xnxqdm, startDate) {
  var d1, d2;
  if (startDate) {
    var s = new Date(startDate.replace(/-/g, '/') + ' 00:00:00');
    var e = new Date(s.getTime());
    e.setDate(e.getDate() + 7 * 32); // 覆盖 32 周
    var s0 = new Date(s.getTime());
    s0.setDate(s0.getDate() - 7);
    d1 = formatDateTime(s0);
    d2 = formatDateTime(e);
  } else {
    var now = new Date();
    var past = new Date(now.getTime()); past.setDate(past.getDate() - 400);
    var future = new Date(now.getTime()); future.setDate(future.getDate() + 400);
    d1 = formatDateTime(past);
    d2 = formatDateTime(future);
  }

  var payload = await postForm(API_TABLE, { xnxqdm: xnxqdm, zc: '', d1: d1, d2: d2 });

  // 页面源码判据：if (resData.code < 0) 视为失败
  if (!payload || typeof payload !== 'object') throw new Error('课表接口返回格式异常。');
  if (typeof payload.code === 'number' && payload.code < 0) {
    throw new Error('课表接口返回错误：' + (payload.message || ('code=' + payload.code)));
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

/**
 * 多教学场地拆分：当 jxcdmc 含逗号（多教室）时，用 jxcdmc2 的「教室-周次」对
 * 还原出每个教室各自的周次集合（与课表页 eventRender 的处理一致）。
 */
function buildPositionGroups(raw) {
  var rooms = cleanText(raw.jxcdmc);
  var pairs = cleanText(raw.jxcdmc2);
  var allWeeks = parseWeeks(raw.zc);

  // 无场地信息：按规范 §6.1 传空字符串，不写「待定」之类的占位文本
  if (!rooms) return [{ position: '', weeks: allWeeks }];
  if (rooms.indexOf(',') === -1 || !pairs) return [{ position: rooms, weeks: allWeeks }];

  var byRoom = {};
  var order = [];
  var segments = pairs.split(',');
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    if (!seg) continue;
    var idx = seg.lastIndexOf('-');
    if (idx <= 0) continue;
    var room = seg.slice(0, idx).trim();
    var week = Number(seg.slice(idx + 1));
    if (!room || !isFinite(week) || week <= 0) continue;
    if (!byRoom[room]) { byRoom[room] = {}; order.push(room); }
    byRoom[room][week] = true;
  }

  if (order.length === 0) return [{ position: rooms, weeks: allWeeks }];

  return order.map(function (room) {
    var ws = Object.keys(byRoom[room]).map(Number);
    return { position: room, weeks: normalizeWeeks(ws) };
  });
}

/** 原始记录 → 规范课程对象数组 */
function parseRecords(records) {
  var out = [];
  for (var i = 0; i < records.length; i++) {
    var raw = records[i];
    if (!raw) continue;

    var name = String(raw.kcmc === null || raw.kcmc === undefined ? '' : raw.kcmc).trim();
    // 星期必须用 xq；qsxq/jsxq 是日历列号（= xq + 1），用错会整体错位一天
    var day = Number(raw.xq);
    var startSection = Number(raw.ps);
    var endSection = Number(raw.pe);

    if (!name) continue;
    if (!isFinite(day) || day < 1 || day > 7) continue;
    if (!isFinite(startSection) || !isFinite(endSection)) continue;
    if (startSection < 1 || endSection < startSection) continue;

    var teacher = cleanTeacher(raw.teaxms);

    var groups = buildPositionGroups(raw);
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (!group.weeks || group.weeks.length === 0) continue;
      out.push({
        name: name,
        teacher: teacher,
        position: group.position || '',
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: group.weeks
      });
    }
  }
  return mergeAndDistinctCourses(out);
}

// ---------------------------------------------------------------------------
// 保存（顺序与容错遵循规范 §9）
// ---------------------------------------------------------------------------
async function saveCourses(courses) {
  try {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    return true;
  } catch (error) {
    toast('课程保存失败：' + errorMessageOf(error));
    return false;
  }
}

async function saveCourseConfig(config) {
  if (!config) return true;
  try {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    return true;
  } catch (error) {
    toast('课表配置保存失败：' + errorMessageOf(error));
    return false;
  }
}

async function saveTimeSlots(timeSlots) {
  if (!timeSlots || timeSlots.length === 0) return false;
  try {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    return true;
  } catch (error) {
    // 规范：时间段导入失败不阻塞课程导入
    toast('作息时间导入失败，可稍后在软件内手动设置：' + errorMessageOf(error));
    return false;
  }
}

// ---------------------------------------------------------------------------
// 流程编排
// ---------------------------------------------------------------------------
async function runImportFlow() {
  toast('课程导入流程即将开始...');

  // 1. 公告与前置检查
  var confirmed = await alertUser(
    '安徽中医药大学课表导入',
    '导入前请确保您已登录教务系统，并已进入「信息查询 → 课表查询」页面。',
    '好的，开始导入'
  );
  if (!confirmed) {
    toast('用户取消了导入。');
    return;
  }

  try {
    // 2. 学期选择
    var semesters = collectSemesters();
    if (!semesters || semesters.length === 0) {
      throw new Error('未能获取到学期列表。');
    }
    var labels = semesters.map(function (s) { return s.label; });
    var defaultIndex = 0;
    for (var i = 0; i < semesters.length; i++) {
      if (semesters[i].selected) { defaultIndex = i; break; }
    }

    var picked = await selectFromList('请选择学期', labels, defaultIndex);
    if (picked < 0 || picked >= semesters.length) {
      toast('导入已取消。');
      return;
    }
    var semester = semesters[picked];
    console.log(TAG + ' 使用学期 ' + semester.value + '（' + semester.label + '）');

    // 3. 开学日期 + 课表数据
    toast('正在获取开学日期...');
    var startDate = await fetchSemesterStartDate(semester.value);

    toast('正在获取 ' + semester.label + ' 的课表...');
    var records = await fetchCourses(semester.value, startDate);
    if (records.length === 0) {
      throw new Error('未获取到课程数据：该学期可能暂无课表，或登录状态已失效。');
    }

    var courses = parseRecords(records);
    if (courses.length === 0) {
      throw new Error('接口返回了 ' + records.length + ' 条记录，但没有任何一条能解析成有效课程。');
    }
    console.log(TAG + ' 原始 ' + records.length + ' 条 → 解析后 ' + courses.length + ' 条');

    // 4. 课表配置（开学日期来自接口；总周数取下限 20，保证不截断任何课程）
    var maxWeek = 0;
    for (var c = 0; c < courses.length; c++) {
      for (var w = 0; w < courses[c].weeks.length; w++) {
        if (courses[c].weeks[w] > maxWeek) maxWeek = courses[c].weeks[w];
      }
    }
    var config = { semesterTotalWeeks: Math.max(maxWeek, 20) };
    if (startDate) {
      config.semesterStartDate = startDate;
    } else {
      toast('未获取到开学日期，可稍后在软件内手动校准周次。');
    }
    var configSaved = await saveCourseConfig(config);
    if (!configSaved) return;

    // 5. 课程数据（核心）
    toast('正在保存 ' + courses.length + ' 条课程记录...');
    var coursesSaved = await saveCourses(courses);
    if (!coursesSaved) return;

    // 6. 作息时间（失败不阻塞）
    await saveTimeSlots(AHTCM_TIME_SLOTS);

    // 7. 完全成功，发送生命周期结束信号
    toast('课程导入成功，共导入 ' + courses.length + ' 条课程记录！');
    if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
      window.shiguangBridge.notifyTaskCompletion();
    }
  } catch (error) {
    console.error(TAG + ' Import Error:', error);
    toast('导入失败：' + errorMessageOf(error));
  }
}

// ---------------------------------------------------------------------------
// 入口（脚本无模块系统，顶层直接执行）
// ---------------------------------------------------------------------------
if (window.shiguangBridge && window.shiguangBridgePromise) {
  runImportFlow();
} else {
  // Alpha 调试降级：桥未注入时暴露手动入口，避免静默失败
  console.log(TAG + ' 未检测到 shiguangBridge，注入后可在控制台执行 __runImportFlow__()');
  window.__runImportFlow__ = runImportFlow;
  window.__ahtcmParseRecords = parseRecords; // 便于在控制台单独验证解析逻辑
}
