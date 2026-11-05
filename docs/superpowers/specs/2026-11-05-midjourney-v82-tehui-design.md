# Midjourney v8.2-特惠

用户确认按每张 2 金币计费，一次固定四张，共 8 金币。标准档、2K 高清和各质量档同价。

模型 ID 为 `midjourney-v8.2-tehui`，上游模型名保持 `Midjourney v8.2-特惠`。唯一线路使用 `https://api.osodm.com`，密钥环境变量 `Midjourney-v8.2-osodm-tehui`。采用异步 POST `/v1/images/midjourney/generations` 和 GET `/v1/images/midjourney/tasks/{taskId}`，沿用现有任务持久化、查询、退款与资产保存。

每次上游请求固定 `n=1`；返回四张单图，读取成功任务的 `result.data`，忽略四宫格预览。画布版创建四个占位节点，经典版保存全部结果。数量表示组数，每组四张、8 金币。

参数映射：尺寸 1K/2K 分别对应 `hd=false/true`；`size` 为十种文档支持的画幅之一。质量字符串 `0.25/0.5/1/2`，默认 `1`。最多一张公网 URL 或 data URL 参考图，通过生成接口提交。不提供蒙版、局部编辑或 4K、智能比例、自定义比例等未声明能力。无效输入在扣费前拒绝。

新库静态初始化；已有数据库显式增量创建模型、线路，保留管理员已有配置。不在启动时恢复被删除的模型。测试覆盖参数、四张结果、计费、失败退款、前端目录与组数，以及导入幂等性。不调用真实付费生成接口。

文档来源：https://api.osodm.com/docs/model/Midjourney%20v8.2-%E7%89%B9%E6%83%A0 （2026-11-05 读取）。
