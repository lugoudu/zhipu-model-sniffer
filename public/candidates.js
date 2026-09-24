/* 内置候选词典（2026-09 重建）
 *
 * 规则一：glm 主线版本号 ≤ 5.2 的候选全部剔除——旧模型已无嗅探价值。
 * 规则二：保留用户实测有差异响应的字面代号 glm-x-preview-{a..z}；
 *         同时保留版本号加 preview 后缀的另一组候选。
 * 规则三：vidu 视频线改用官方定价页实锤的调用名（viduq1-* / vidu2-*，无空格
 *         无横线连写），并沿 viduq1→vidu2 的直进位规律外推 vidu3-*。
 *
 * 注意：版本号过滤只针对 glm 主线（glm-x.y）；
 * 专用线（cogview / cogvideox / embedding / autoglm 等）编号独立，不受 5.2 规则约束。
 */

// 官方模型概览页确认的已开放模型（调用名小写）——仅作“已开放对照”，不参与默认嗅探
const OPEN_MODELS_SEED = {
  '旗舰与主力文本': [
    'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
    'glm-4.7', 'glm-4.6', 'glm-4-long',
  ],
  '轻量与免费文本': [
    'glm-4.7-flash', 'glm-4.7-flashx', 'glm-4.5-flash', 'glm-4.5-air', 'glm-4.5-airx', 'glm-4-flash-250414',
  ],
  '视觉理解': [
    'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5v-turbo', 'glm-4.6v', 'glm-4.6v-flash',
    'glm-4.1v-thinking-flash', 'glm-4.1v-thinking-flashx', 'glm-4v-flash', 'autoglm-phone', 'glm-ocr',
  ],
  '图像 / 视频 / 音频': [
    'glm-image', 'cogview-4', 'cogview-3-flash',
    'cogvideox-3', 'cogvideox-flash',
    'viduq1-text', 'viduq1-image', 'viduq1-start-end',
    'vidu2-image', 'vidu2-start-end', 'vidu2-reference',
    'glm-asr-2512', 'glm-tts', 'glm-tts-clone', 'glm-realtime', 'glm-4-voice',
  ],
  '向量 / 其他': [
    'embedding-2', 'embedding-3', 'rerank', 'charglm-4', 'emohaa', 'codegeex-4',
  ],
};

// Preview 内测代号（2026-09 重建）：实锤形态 glm-<版本>-preview；
// 其中 glm-5.4-flash-preview / glm-6-flash-preview 为组合推测（中置信度）
const PREVIEW_NAMES = [
  'glm-5.4-preview', 'glm-5.5-preview', 'glm-6-preview', 'glm-5.3-preview',
  'glm-5.4-flash-preview', 'glm-6-flash-preview',
];
const LETTER_PREVIEW_NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => `glm-x-preview-${letter}`);

// 悬念候选（全部 > glm-5.2；专用线除外）
const CANDIDATE_GROUPS = {
  'Preview 字面代号（a/f/g/k 已有用户实测差异）': LETTER_PREVIEW_NAMES,
  'Preview 内测代号（实锤形态 glm-<版本>-preview）': PREVIEW_NAMES,
  '版本号外推（下一代）': [
    'glm-5.4', 'glm-5.5', 'glm-6',
    'glm-5.4-flash', 'glm-5.5-flash', 'glm-6-flash', 'glm-6-turbo',
    'glm-5.4-flashx', 'glm-6-flashx', 'glm-5.4-turbo', 'glm-5.5-turbo',
  ],
  '5.3 变体外推（当前顶点的后缀家族）': [
    'glm-5.3-plus', 'glm-5.3-air', 'glm-5.3-airx', 'glm-5.3-pro', 'glm-5.3-turbo',
  ],
  '多模态外推（> 5.2 的镜像线）': [
    'glm-5.3v', 'glm-5.3v-flash', 'glm-5.3v-plus',
    'glm-5.4v', 'glm-5.4v-flash', 'glm-5.5v', 'glm-6v',
    'autoglm-2', 'autoglm-pc', 'autoglm-browser',
    'glm-ocr-2', 'glm-ocr-pro', 'glm-ocr-flash',
  ],
  '语音 / 视频生成外推': [
    'glm-asr', 'glm-asr-2', 'glm-asr-pro',
    'glm-tts-2', 'glm-tts-pro', 'glm-realtime-2',
    'cogvideox-4', 'cogvideox-3-plus', 'cogvideox-3-flash',
    'vidu3-text', 'vidu3-image', 'vidu3-start-end', 'vidu3-reference',
    'glm-video', 'glm-video-2',
  ],
  '图像生成外推': [
    'cogview-5', 'cogview-4-plus', 'cogview-4-flash', 'glm-image-2',
  ],
  '向量 / 代码 / 智能体外推': [
    'embedding-4', 'rerank-2', 'rerank-pro',
    'codegeex-5', 'codegeex-next', 'charglm-5', 'emohaa-2',
    'glm-agent', 'glm-zero', 'glm-zero-proto',
  ],
};

// 生成器可选后缀（2026-09 追加 -preview / -long / -x / -thinking-flash：-preview 为实锤预发布后缀，
// -long / -x / -thinking-flash 对应官方已有档位 glm-4-long / glm-4.5-x / glm-4.1v-thinking-flash）
const GEN_SUFFIX_OPTIONS = [
  '', '-flash', '-flashx', '-air', '-airx', '-plus', '-pro', '-turbo', '-v', '-v-flash', '-thinking',
  '-preview', '-long', '-x', '-thinking-flash',
];

// 已知免费模型（验证 Key 时按序尝试：官方已标注 glm-4.7-flash 免费，glm-4.5-flash 作回退；不参与嗅探候选）
const FREE_MODELS = ['glm-4.7-flash', 'glm-4.5-flash'];

// —— 兼容别名（仅供仍引用旧标识符的外部结构校验脚本求值，勿在新代码使用）——
// FREE_MODEL：单值旧名，指向 FREE_MODELS 回退链的首选。
// （PREVIEW_NAMES 已恢复为独立常量并被 CANDIDATE_GROUPS 的 Preview 组引用，持有 6 个实锤形态名）
const FREE_MODEL = FREE_MODELS[0];
