# 列出可用的 recipe.
[private]
default:
    @just --list

# 安装项目依赖.
install:
    pnpm install

# 执行 TypeScript 类型检查, 不生成文件.
typecheck:
    pnpm run typecheck

# 运行单元测试.
test:
    pnpm test

# 构建 lib 产物 (ESM 与类型声明).
build:
    pnpm run build

# 类型检查, 测试, 构建与打包预览.
verify:
    just typecheck
    just test
    just build
    pnpm pack --dry-run

# 删除依赖与本地临时产物.
clean:
    rm -rf node_modules/
    rm -rf .tmp/
