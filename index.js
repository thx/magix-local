var fs = require('fs');
var path = require('path');
var prompt = require('prompt');
var cp = require('child_process');
var process = require('process');
var sep = path.sep;
var innerPathReg = /(['|"]?)@([^.]+)(\.html|\.less|\.css|\.sass)(['"]?)/g;

var copyFile = function(from, to, callback) {
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
        if (callback) {
            callback(content).then(function(c) {
                fs.writeFileSync(to, c);
            });
        } else {
            fs.writeFileSync(to, content);
        }
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


var Tool = {
    pkgs: [],
    count: 0,
    test: function(rules, p) {
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i] instanceof RegExp ? rules[i] : new RegExp(rules[i])
            if (rule.test(p)) return true;
        }
        return false;
    },
    readPkg: function(path){
        var str = fs.readFileSync(path).toString();
        var o = JSON.parse(str);
        return o;
    },
    install: function(mod,callback){
        // 检测tnpm 没有就用 npm
        var cmd = 'tnpm install '
        if (mod) {
            cmd += mod + ' --save'
        }
        console.log(mod + ' is install....')
        cp.exec(cmd,{},function(err, stdout, stderr){
            if (err) {
                console.error(err)
                return
            }
            callback && callback()
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
                        pkgjson = Tool.readPkg(file1)
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
    copyPkgFile: function(from, to, next) {
        var extname = path.extname(from);

        console.log('copying file ' + from + ' to ' + to + ' ...')

        if (fs.existsSync(to)) {
            prompt.start();
            var property = {
                name: 'yesno',
                message: 'already exists:' + to + ',overwrite it?',
                validator: /y[es]*|n[o]?/,
                warning: 'Must respond yes or no',
                default: 'no'
            };
            prompt.get(property, function(err, result) {
                if (result.yesno == 'yes' || result.yesno == 'y') {
                    copyFile(from, to, function(content) {
                        return new Promise(function(resolve) {
                            resolve(content);
                        });
                    });
                    next();
                } else {
                    next();
                }
            });
        } else {
            copyFile(from, to, function(content) {
                return new Promise(function(resolve) {
                    resolve(content);
                });
            });
            next();
        }
    },

    getFileListFromPkg: function(pkgs) {
        var list = [];
        pkgs.forEach(function(pkg) {
            var mainPath = path.resolve(pkg.folder,pkg.pkgjson.main)
            var aim = pkg.pkgjson.aim
            // 没有写的模块，就使用名称
            if (!aim) aim = pkg.pkgjson.name
            // 先加主要模块
            list.push({
                from: mainPath,
                to: aim +  path.sep + path.basename(mainPath)
            });

            var mainContent = fs.readFileSync(mainPath).toString()
            var match,file
            while ((match = innerPathReg.exec(mainContent)) != null) {
                file = path.resolve(pkg.folder,match[2]+match[3])
                list.push({
                    from: file,
                    to: aim + path.sep + path.basename(file)
                });
            }
        });
        return list;
    },
    copyFileList: function(list) {
        var next = function() {
            var one = list.shift();
            if (one) {
                Tool.copyPkgFile(one.from, one.to, next);
            }
        };
        next();
    }
};




module.exports = {
    // 通过package.json来同步文件
    syncPkg: function(json, aim, rules) {
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
            Tool.copyFileList(fList);
        });
    },
    // 通过直接指定模块名的方式来同步文件
    syncMod: function(mod, aim){
        // 先安装到本地
        Tool.install(mod, function(){
            var dir = process.cwd();
            var full = dir + sep + 'package.json';
            var nodeModules = dir + sep + 'node_modules' + sep;
            var modName = mod.replace(/\@[\d\.]+/,'');
            var rules = [new RegExp(modName)];
            Tool.walk(full, nodeModules, rules, function(pkgs) {
                // 第一个pkg就是我们需要同步的那个，改写他的目标目录
                aim && (pkgs[0].pkgjson.aim = aim)
                var fList = Tool.getFileListFromPkg(pkgs);
                Tool.copyFileList(fList);
            });
        })
    }
}
