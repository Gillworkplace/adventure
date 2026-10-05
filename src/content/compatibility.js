import { MODEL_ID } from "../compute/vela/model.js";
const descriptions = {
  "local-model-missing": ["模型文件缺失", `请将所需版本的 model.bin.gz 保持压缩状态，直接放入 public/models/${MODEL_ID}/ 文件夹。`],
  wasm: ["不支持模型运行功能", "此浏览器无法使用模型运行功能。请更新浏览器或选择 X36。"],
  worker: ["无法使用计算功能", "无法启动独立计算功能。请更新浏览器，或检查扩展程序和网站限制设置。旧版本仍可使用。"],
  streams: ["不支持文件处理功能", "缺少处理大体积模型文件的功能。请更新浏览器或选择 X36。"],
  crypto: ["无法使用文件校验功能", "无法使用校验模型文件的功能。请通过安全连接以最新浏览器重新访问，或选择 X36。"],
  network: ["需要检查连接", "文件加载失败。请检查文件位置和连接状态后重试。"],
  "check-timeout": ["需要检查响应", "浏览器响应迟缓。请减少其他任务后重新确认。"],
  memory: ["内存不足", "请关闭其他应用或标签页后重试，或选择 X36。"],
  integrity: ["文件校验失败", "模型文件不完整或与所需版本不符。请准备正确的文件后重试。"],
  model: ["模型运行失败", "模型准备失败。请重试或选择 X36。"],
  "cache-missing": ["读取已保存模型失败", "浏览器无法读取已保存的模型。请重新加载模型或选择其他模型。"],
  "storage-unsupported": ["不支持模型保存", "此浏览器不支持所需的存储功能。请更新浏览器，或仅本次访问期间使用模型。"],
  "storage-full": ["存储空间不足", "没有足够空间保存新模型。请清理设备存储空间，或选择仅本次使用。更新期间会同时保留原有文件。"],
  "storage-denied": ["存储访问受限", "请在浏览器的网站数据设置中允许存储。无痕窗口或网站限制设置可能导致存储受限。"],
  "storage-busy": ["存储文件正在使用中", "模型文件可能正在被其他标签页使用。请关闭其他 Adventure 标签页后重试。"],
  "storage-failed": ["模型保存失败", "模型保管失败。本次仍可使用，但下次访问时可能需要重新加载模型文件。"],
  "gpu-unsupported": ["不支持 GPU 计算", "此浏览器不支持 GPU 计算。请选择 CPU 或更新浏览器。"],
  "gpu-adapter": ["无法使用 GPU", "浏览器未提供可用的 GPU。请检查图形加速设置和驱动程序，或选择 CPU。"],
  "gpu-test": ["GPU 计算检测失败", "无法在此设备上验证 GPU 计算结果。请更新浏览器和显卡驱动，或选择 CPU。"],
  "gpu-lost": ["GPU 连接已断开", "GPU 连接已断开，将改用 CPU 计算。请减少其他任务，或在计算设置中重新检查 GPU。"],
};
export function compatibilityMessage(code) {
  const [title, detail] = descriptions[code] || descriptions.network;
  return { title, detail };
}
