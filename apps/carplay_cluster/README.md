# CarPlay Cluster

在仪表中央地图区显示 CarPlay 画面（1088×480），用一个车机应用统一控制：打补丁、开关投屏、隐藏宝马转向提示框。

本应用是**控制面板**，不包含任何原生代码：它通过两个 Unix socket 操作已经安装好的开源服务 `waze-on-cluster`（[robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps)）。它不会安装服务、不会写 `/usr/bin/carplay`，也不会绕过 Apple 的 MFi/FairPlay。

## 前置条件

1. 车机上已安装 **Waze on Cluster**（`cluster-render` + `waze-on-cluster` + patchd 守护进程），来自上游项目或 MGU Store 的该组件。没有它时应用会显示 `Service not installed`。
2. CarPlay 从宝马自己的菜单启动。本应用不会主动拉起 CarPlay 会话。
3. 首次使用时补丁可能需要重启车机才生效（界面显示 `Patched after restart` 时按 Restart）。

## 使用

| 按钮 | 作用 |
| --- | --- |
| **Patch / Remove CarPlay** | 写入或还原 CarPlay 捕获补丁（patchd `apply` / `revert`，`panel=high`、`mode=avb`，与上游一致） |
| **Show / Hide projection** | 让仪表地图槽显示或隐藏 CarPlay 流 |
| **BMW turn box** | 切换 CarPlay 显示时是否隐藏宝马自己的转向提示框 |
| **Restart head unit** | 补丁延后生效时请求重启（受 patchd 的重启频率限制） |

状态说明：

* `Service not running`：服务已装但进程没起来
* `Not supported on this car`：patchd 拒绝了该车机（与固件/车型有关，无法绕过）
* `Not patched` / `Patched` / `Patched (update needed)`：补丁状态

## 选项

* **Apply patch and show map when opened**：打开应用时自动打补丁并开启投屏（默认关闭，避免误触发）
* **Hide BMW turn-by-turn box while map shows**：打开应用时同步隐藏宝马转向框（默认关闭）

## 尺寸

补丁向手机通告的尺寸固定为 1088×480、安全区 `504x368+286+72`，这是仪表地图槽的原生尺寸；修改它需要重新编译原生组件（上游只给 HUD 提供了尺寸滑块）。因此本应用不提供大/中/小选项，缩放在原生侧做不了运行时调整。

## 安全

* 仅在停车时测试；本应用不替代宝马原有的任何安全提示。
* 补丁会修改车机上的 CarPlay 程序文件，存在导致 CarPlay 不可用的风险；patchd 自带开机恢复和 `revert`。
* 补丁协议与状态字段来自上游 GPL-3.0-or-later 项目 `robertnisipeanu/idrive-apps`，本应用独立实现，未复制其代码。
