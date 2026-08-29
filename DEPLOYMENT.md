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
```

## 更新

```bash
cd /opt/nhanes-agent
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d --remove-orphans
docker image prune -f
```

## 回滚

把 `.env` 中的 `APP_IMAGE` 从 `latest` 改为已发布的 `sha-<commit>` 标签，然后重新执行 `docker compose up -d`。不要使用会删除数据卷的命令。

## 运维检查

```bash
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --tail=200 app
docker compose -f compose.production.yaml logs --tail=200 caddy
```

当前版本只适合演示和内部测试。启用真实研究数据和 R 执行前，需要加入身份认证、PostgreSQL、对象存储、任务队列、备份、限流和独立 R Worker。
