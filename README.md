# opencli-plugin-stockanalysis

`stockanalysis.com` 的 `opencli` 插件，走公开页面抓取，不需要登录，也不依赖私有 API。

当前实现已经改成 JS public adapter，不再依赖 `browser evaluate`，因此比早期 YAML 版明显更快。

## Commands

- `search`：搜索股票、ETF、基金
- `quote`：查看单只股票概览
- `financials`：查看公司财务数据
- `gainers`：涨幅榜
- `losers`：跌幅榜
- `active`：成交活跃榜
- `earnings`：财报日历
- `news`：市场新闻

## Install

推荐用复制安装，而不是整个目录做 symlink。`opencli 1.3.1` 能稳定识别真实目录里的 plugin 文件，但不稳定识别站点目录 symlink。

```bash
mkdir -p ~/.opencli/plugins
mkdir -p ~/.opencli/plugins/stockanalysis
cp /path/to/opencli-plugin-stockanalysis/*.js ~/.opencli/plugins/stockanalysis/
```

也可以直接运行仓库自带脚本：

```bash
OPENCLI_PLUGIN_DIR="$HOME/.opencli/plugins/stockanalysis" bash ./install.sh
```

## Usage

```bash
opencli stockanalysis search AAPL
opencli stockanalysis quote NVDA
opencli stockanalysis financials NVDA
opencli stockanalysis financials NVDA --statement balance
opencli stockanalysis financials NVDA --statement cashflow --metric "Free Cash Flow" --period quarterly --limit 4
opencli stockanalysis gainers --limit 5
opencli stockanalysis losers --limit 5
opencli stockanalysis active --limit 5
opencli stockanalysis earnings --limit 10
opencli stockanalysis earnings --date 2026-01-27 --limit 5
opencli stockanalysis news --limit 10
```

## Notes

- 当前实现基于公开 SSR HTML 和页面内嵌数据。
- `stockanalysis.com` 页面结构变动后，解析规则可能需要同步更新。
- `opencli explore` 当前能识别这是 `public` 站点，但自动合成不出可用命令，所以这里采用手写 plugin。
- 当前验证环境为 `opencli v1.3.1`。
