var fs = require('fs-extra');
var path = require('path');
var prompt = require('prompt');
var cp = require('child_process');
var process = require('process');
var sep = path.sep;
var innerPathReg = /(['|"]?)@([^.]+)(\.html|\.less|\.css|\.sass)(['"]?)/g;

var copyFile = function(from, to) {
    if (fs.existsSync(from)) {
        var folders = path.dirname(to).split(sep);
        var p = '';
        while (folders.length) {
            p += folders.shift() + sep;
            if (!fs.existsSync(p)) {
                fs.mkdirSync(p);
            }
        }
        var content = fs.readFileSync(from) + '';
        fs.writeFileSync(to, content);
    }
};
var walk = function(folder, callback) {
    var files = fs.readdirSync(folder);
    files.forEach(function(file) {
        var p = folder + sep + file;
        var stat = fs.lstatSync(p);
        if (stat.isDirectory()) {
            walk(p, callback);
        } else {
            callback(p);
        }
    });
};

var log = function(message){
    console.log(message);
};

var LOCAL_VERSION = {
    config:{},
    versionPath:process.cwd() + sep + '.localversion',
    read: function(){
        versionPath = this.versionPath;
        if (fs.existsSync(versionPath)) {
            this.config = JSON.parse(fs.readFileSync(versionPath).toString() || '{}');
        }else{
            this.config = {};
        }
    },
    write: function(){
        fs.writeJSONSync(this.versionPath,this.config);
    },
    set:function(name,path,version){
        if (!this.config[name]) this.config[name] = {};
        this.config[name][path] = version;
    },
    get:function(name,path){
        if (!this.config[name]) return '0.0.0';
        return this.config[name][path];
    }
}

var Tool = {
    pkgs: [],
    hasHandledPkgs: [],
    count: 0,
    prompt: false, //是否开启覆盖确认提示
    test: function(rules, p) {
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i] instanceof RegExp ? rules[i] : new RegExp(rules[i]);
            if (rule.test(p)) return true;
        }
        return false;
    },
    readPkg: function(path){
        var str = fs.readFileSync(path).toString();
        var o = JSON.parse(str);
        return o;
    },
    getNpm: function(){
        var tnpmPath = process.env.NODE_PATH + '/tnpm';
        if (fs.existsSync(tnpmPath)) {
            return 'tnpm';
        }else{
            return 'npm';
        }
    },
    install: function(mod,callback){
        // 检测tnpm 没有就用 npm
        var result;
        var cmd = Tool.getNpm() + ' install ' + mod + ' --save';

        log(mod + ' is install....');
        cp.exec(cmd,{},function(err, stdout, stderr){
            if (err) {
                console.error(err);
                return;
            }
            callback && callback();
        })
    },
    walk: function(json, modules, rules, cb) {
        Tool.count++;
        var o = Tool.readPkg(json);
        var deps = o.dependencies;
        var localrules = o.rules;

        // 给之前的记录加上 pkg
        if (Tool.pkgs.length > 0) {
            Tool.pkgs[Tool.pkgs.length-1].pkgjson = o;
            // 合并组件自己的rules
            rules = rules.concat(localrules);
        }

        if (deps) {
            for (var p in deps) {
                if (!Tool.pkgs[p] && Tool.test(rules, p)) {
                    var file1 = modules + p + path.sep + 'package.json';
                    var modules2 = path.dirname(json) + path.sep + 'node_modules' + path.sep + p + path.sep;
                    var file2 = modules2 + 'package.json';
                    if (fs.existsSync(file1)) {
                        pkgjson = Tool.readPkg(file1);
                        Tool.pkgs.push({
                            folder: modules + p + path.sep,
                            name: p
                        });
                        Tool.walk(file1, modules, rules, cb);
                    } else if (fs.existsSync(file2)) {
                        pkgjson = Tool.readPkg(file2)
                        Tool.pkgs.push({
                            folder: modules2,
                            name: p
                        });
                        Tool.walk(file2, modules2, rules, cb);
                    }
                }
            }
        }
        Tool.count--;
        if (!Tool.count) {
            cb(Tool.pkgs);
        }
    },
    copyPkg: function(one, next){
        var from = one.from;
        var to = one.to;
        var pkgName = one.pkgjson.name;
        var pkgVersion = one.pkgjson.version;
        var namWithVersionTo = pkgName + ':' + pkgVersion + ' to ' + one.to;

        // 如果重复（前面已经处理过了），那么直接跳过
        if (Tool.hasHandledPkgs.indexOf(namWithVersionTo) !== -1) {
            next();
            return
        }
        Tool.hasHandledPkgs.push(namWithVersionTo);
        // 几种情况
        // 1. 之前的目录没有，那么直接写入
        // 2. 版本比之前的更高，直接覆盖
        // 3. 版本比之前的更低，直接忽略
        // 4. 版本跟之前的不匹配（包括高或者低），并且加了  --prompt 参数，那么由用户自己选择是否需要覆盖
        var preVersion = LOCAL_VERSION.get(pkgName,one.to);

        if (!fs.existsSync(to)) {
            Tool.copyPkgFile(from, to, one);
            next();
            return
        }

        if (pkgVersion > preVersion && !Tool.prompt) {
            Tool.copyPkgFile(from, to, one);
            next();
            return
        }

        if (pkgVersion <= preVersion && !Tool.prompt) {
            if(pkgVersion < preVersion) log('ignore: '+ pkgName + ' to ' + one.to + ', new version('+pkgVersion+') is below the origin('+preVersion+')')
            next();
            return
        }

        if (preVersion != pkgVersion && Tool.prompt) {
            prompt.start();
            var property = {
                name: 'yesno',
                message: 'already exists:' + pkgName + ',need sync ' + namWithVersionTo + ' overwrite it?',
                validator: /y[es]*|n[o]?/,
                warning: 'Must respond yes or no',
                default: 'no'
            };
            prompt.get(property, function(err, result) {
                if (result.yesno == 'yes' || result.yesno == 'y') {
                    Tool.copyPkgFile(from, to, one);
                    next();
                } else {
                    next();
                }
            });
        }
    },
    copyPkgFile: function(from, to, one) {
        var extname = path.extname(from);
        var source = null;

        log('syncing package: ' + one.pkgjson.name + ':' + one.pkgjson.version + ' to ' + one.to);

        copyFile(from, to);

        LOCAL_VERSION.set(one.pkgjson.name,one.to,one.pkgjson.version);

        if (!one.resources) return;
        // 如果有相关资源，那么要一起拷贝
        for (var i = 0; i < one.resources.length; i++) {
            source = one.resources[i];
            copyFile(source.from, source.to);
        }
    },

    getFileListFromPkg: function(pkgs) {
        var list = [];
        pkgs.forEach(function(pkg) {
            var mainPath = path.resolve(pkg.folder,pkg.pkgjson.main);
            var aim = pkg.pkgjson.aim;
            // 没有写的模块，就使用名称
            if (!aim) aim = pkg.pkgjson.name;
            // 先加主要模块
            var fileObj = {
                from: mainPath,
                to: aim +  path.sep + path.basename(mainPath),
                pkgjson: pkg.pkgjson
            }
            // magix组件需要增加资源文件
            if (/^mx-/.test(pkg.pkgjson.name)) {
                var mainContent = fs.readFileSync(mainPath).toString();
                var match,file;
                while ((match = innerPathReg.exec(mainContent)) != null) {
                    file = path.resolve(pkg.folder,match[2]+match[3]);
                    fileObj.resources = fileObj.resources || [];
                    fileObj.resources.push({
                        from: file,
                        to: aim + path.sep + path.basename(file)
                    })
                }
            }
            list.push(fileObj);
        })
        return list;
    },
    copyPkgList: function(list) {
        var next = function() {
            var one = list.shift();
            if (one) {
                Tool.copyPkg(one, next);
            }else{
                // 写入最新的
                LOCAL_VERSION.write();
            }
        };
        next();
    }
};

module.exports = {
    // 通过package.json来同步文件
    syncPkg: function(json, aim, rules, prompt) {

        Tool.prompt = prompt;
        LOCAL_VERSION.read();
        var full = path.resolve(json);
        var dir = path.dirname(full);
        var nodeModules = dir + path.sep + 'node_modules' + path.sep;
        if (!rules) {
            rules = [/mx-/];
        }
        Tool.walk(full, nodeModules, rules, function(pkgs) {
            // 匹配到规则的都需要改写aim
            for (var i = 0; i < pkgs.length; i++) {
                if(Tool.test(rules,pkgs[i].name)) pkg.pkgjson.aim = aim;
            }
            var fList = Tool.getFileListFromPkg(pkgs);
            Tool.copyPkgList(fList);
        });
    },
    // 通过直接指定模块名的方式来同步文件
    syncMod: function(mod, aim, prompt){
        Tool.prompt = prompt;
        // 先安装到本地
        Tool.install(mod, function(){

            LOCAL_VERSION.read();

            var dir = process.cwd();
            var full = dir + sep + 'package.json';
            var nodeModules = dir + sep + 'node_modules' + sep;
            var modName = mod.replace(/\@[\d\.]+/,'');
            var rules = [new RegExp(modName)];
            Tool.walk(full, nodeModules, rules, function(pkgs) {
                // 第一个pkg就是我们需要同步的那个，改写他的目标目录
                aim && (pkgs[0].pkgjson.aim = aim);
                var fList = Tool.getFileListFromPkg(pkgs);
                Tool.copyPkgList(fList);
            });
        })
    }
}
