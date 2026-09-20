# 云端部署

## 前提

- 一台 Ubuntu 服务器，公网开放 22、80、443 端口。
- 一个域名，A/AAAA 记录指向服务器。
- Docker Engine 与 Docker Compose 插件。
- GitHub Container Registry 中的镜像可被服务器拉取。

## 首次部署

在服务器创建 `/opt/nhanes-agent`，将 `compose.production.yaml`、`Caddyfile` 和 `.env.example` 放入该目录。

```bash
cd /opt/nhanes-agent
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少设置真实的 `DOMAIN` 和 `NCBI_EMAIL`。密钥不得提交到 Git。

```bash
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
curl -fsS https://你的域名/api/health
curl -fsS https://你的域名/api/health/diagnostics
```

诊断结果中的 `backups.state` 应在首次启动约 5 秒后变为 `protected`。默认每天创建一次 SQLite 在线备份，在 Docker 数据卷的 `/data/backups` 中保留 14 天、最多 30 份；每份数据库旁都有对应的 SHA-256 校验文件。

## 更新

```bash
cd /opt/nhanes-agent
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d --remove-orphans
docker image prune -f
```

## GitHub 自动部署到阿里云

主分支推送通过 `.github/workflows/container.yml` 自动运行测试，并在测试通过后把当前 Git 提交的归档流式发送到服务器。服务器端只允许部署密钥调用 `/usr/local/sbin/deploy-nhanes-agent`；该命令会校验提交号、归档大小、路径和文件类型，再构建并切换容器。

仓库需要配置以下 Actions secrets：

- `ALIYUN_HOST`：服务器公网 IP 或域名。
- `ALIYUN_DEPLOY_KEY`：受限部署私钥。
- `ALIYUN_KNOWN_HOSTS`：经过核验的服务器 SSH 主机密钥。

仓库变量 `ALIYUN_AUTO_DEPLOY=true` 用于启用发布。服务器的 `authorized_keys` 必须把对应公钥限制为：

```text
restrict,command="/usr/local/sbin/deploy-nhanes-agent" ssh-ed25519 ...
```

发布失败时，新容器会被移除，原容器自动恢复。模型密钥只保存在服务器 `/etc/nhanes-agent/model.env`，不会进入 GitHub、镜像或发布归档。

## 回滚

把 `.env` 中的 `APP_IMAGE` 从 `latest` 改为已发布的 `sha-<commit>` 标签，然后重新执行 `docker compose up -d`。不要使用会删除数据卷的命令。

## 运维检查

```bash
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --tail=200 app
docker compose -f compose.production.yaml logs --tail=200 caddy
```

正式公网使用前应配置域名、HTTPS 和管理员认证，并定期演练备份恢复。若后续扩展到多用户或高并发，再将 SQLite 与进程内任务执行迁移到独立数据库、对象存储和 Worker。
