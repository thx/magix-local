var fs = require('fs');
var path = require('path');
var prompt = require('prompt');
var sep = path.sep;
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
            if (rules[i].test(p)) return true;
        }
        return false;
    },
    walk: function(json, modules, rules, cb) {
        Tool.count++;
        fs.readFile(json, function(err, data) {
            var str = data.toString();
            var o = JSON.parse(str);
            var deps = o.dependencies;
            if (deps) {
                for (var p in deps) {
                    if (!Tool.pkgs[p] && Tool.test(rules, p)) {
                        var file1 = modules + p + path.sep + 'package.json';
                        var modules2 = path.dirname(json) + path.sep + 'node_modules' + path.sep + p + path.sep;
                        var file2 = modules2 + 'package.json';
                        if (fs.existsSync(file1)) {
                            Tool.pkgs.push({
                                folder: modules + p + path.sep,
                                name: p.replace('@alife/', '')
                            });
                            Tool.walk(file1, modules, rules, cb);
                        } else if (fs.existsSync(file2)) {
                            Tool.pkgs.push({
                                folder: modules2,
                                name: p.replace('@alife/', '')
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
        });
    },
    copyPkgFile: function(from, to, next) {
        var extname = path.extname(from);
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
                            if (extname == '.js') {
                                content = Tool.resolveRequire(content);
                                resolve(content);
                            } else {
                                resolve(content);
                            }
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
                    if (extname == '.js') {
                        content = Tool.resolveRequire(content);
                        resolve(content);
                    } else {
                        resolve(content);
                    }
                });
            });
            next();
        }
    },
    getFileListFromPkg: function(pkgs, aim) {
        var list = [];
        pkgs.forEach(function(pkg) {
            walk(pkg.folder + 'tmpl', function(file) {
                list.push({
                    from: file,
                    to: aim + pkg.name + path.sep + path.basename(file)
                });
            });
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
    },
    aliReg: /\brequire\((['"])@alife\/([^'"]+)\1\)/g,
    resolveRequire: function(content) {
        return content.replace(Tool.aliReg, function(match, q, name) {
            return 'require(\'../' + name + '/index\')';
        });
    }
};
module.exports = function(json, aim, rules) {
    var full = path.resolve(json);
    var stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
        var list = [];
        walk(full, function(file) {
            var part = file.replace(full, '');
            list.push({
                from: file,
                to: aim + part
            });
        });
        Tool.copyFileList(list);
    } else {
        var dir = path.dirname(full);
        var nodeModules = dir + path.sep + 'node_modules' + path.sep;
        if (!rules) {
            rules = [/^@alife\/mx-/];
        }
        Tool.walk(full, nodeModules, rules, function(pkgs) {
            var fList = Tool.getFileListFromPkg(pkgs, aim);
            Tool.copyFileList(fList);
        });
    }
};