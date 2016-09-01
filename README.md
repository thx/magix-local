# Magix Local

magix配套工具，把Magix项目模块从node_modules同步到项目本地


## 安装与使用


``` js
npm install magix-local -g
```

运行：

``` js
ms 模块名 需要同步的目录（可选）

```
> eg:ms @alife/mx-sem-share app/views/test

## 同步规则

模块全部托管在npm。一般模块的package.json会包括下面配置：

``` js
"aim": "atom/dialog",   // 标明当前模块安装后期望的目标目录
"rules": ["^mx-"],      // 匹配规则，会去匹配dependencies里面依赖的模块，匹配成功，也会安装到本地
"dependencies": {       //  依赖的模块，如果希望安装后依赖的模块也被安装，那么记得rules
  "mx-atom-zepto": "^0.0.1",
  "mx-atom-magix": "^0.0.1",
  "mx-atom-mask": "^0.0.1"
},

```

命令本身不去处理版本号依赖的问题，如果一个模块同步时本地已有，会给出是否覆盖的提示。

如果需要审计模块，可以在模块名后面加上版本号：

``` js
ms @alife/mx-sem-share app/views/test
```
