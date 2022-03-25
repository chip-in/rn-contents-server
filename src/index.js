import webClient from 'request';
import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '@chip-in/resource-node';
import http from 'http';
import Path from 'path-parser'
import typeis from 'type-is'

process.on('unhandledRejection', console.dir);

if (process.argv.length !== 4) {
  console.log("Usage: npm start -- " +
              "<core_node_url(e.g. 'http://test-core.chip-in.net')> "+
              "<node_class(e.g. 'rn-contents-server')> ")
  process.exit(0);
}
var coreNodeUrl = process.argv[2];
var nodeClass =  process.argv[3];

var jwtToken = process.env.ACCESS_TOKEN;
var jwtRefreshPath = process.env.TOKEN_UPDATE_PATH;

class SignalHandler {
  constructor(node) {
    this.targets = ["SIGINT", "SIGTERM"];
    this.node = node;
    this._init();
  }
  _init() {
    this.targets.map((s)=>process.on(s, ()=>{
      this.node.logger.info("Shutdown process start.");
      this._execShutdown();
    }));
  }
  _execShutdown() {
    this.node.stop()
    .then(()=>{
      this.node.logger.info("Shutdown process has completed.");
      setImmediate(function() {
				process.exit(0);
			});
    })
  }
}
class StaticFileServer extends ServiceEngine{
  constructor(option) {
    super(option);
    this.port = 13000;
    this.path = option.path;
    this.mode = option.mode;
    this.rewriteRule = option.rewriteRule;
  }
  
  start(node) {
    return Promise.resolve()
      .then(()=>this._startWebServer())
      .then(()=>node.mount(this.path, this.mode, new ReverseProxy(node, this.path, this.port, this.rewriteRule)))
      .then((ret)=>this.mountId = ret)
      .then(()=>node.logger.info("rn-contents-server started. Try to access '" + coreNodeUrl + this.path + "'"))
  }

  stop(node) {
    return Promise.resolve()
      .then(()=>{
        if (this.server == null) {
          return Promise.resolve();
        }
        return this._stopWebServer();
      })
  }

  _startWebServer() {
    return Promise.resolve()
      .then(()=>{
        var express = require('express');
        var logger = require('morgan');
        var path = require('path');
        var app = express();
        
        app.use(logger('combined'));
        app.use(express.static(path.join(__dirname, '../public')));

        this.server = http.createServer(app);
        this.server.listen(this.port);
        console.log('listening on port ' + this.port);
      })
  }
  _stopWebServer() {
    return Promise.resolve()
      .then(()=>{
        this.server.close();
      })
  }

  getPort() {
    return this.port;
  }
}

class ReverseProxy extends Proxy {
  constructor(rnode, path, port, rewriteRule) {
    super();
    this.rnode = rnode;
    if (path == null) {
      throw new Error("Path is empty")
    }
    this.basePath = path[path.length - 1] !== "/" ? path + "/" : path;
    this.port = port;
    this.rewriteRule = [];
    if (rewriteRule != null) {
      var defs = [].concat(rewriteRule);
      defs.forEach((def)=>{
        try {
          this.rewriteRule.push({
            "source" : new Path(def.source),
            "dest" : def.dest
          });
        } catch (e) {
          this.rnode.logger.error("Failed to parse rewrite rule def:" + def, e);
        }
      })
    }
  }
  onReceive(req, res) {
    return Promise.resolve()
      .then(() => {
        var method = req.method || "GET";
        if (method !== "GET" && method !== "POST") {
          this.rnode.logger.error("This sample support only GET|POST method.");
          return Promise.reject(new Error("This sample support only GET|POST method."));
        }
        if (req.url.indexOf(this.basePath) !== 0) {
          this.rnode.logger.error("Unexpected path is detected:" + req.url);
          return Promise.reject(new Error("Unexpected path is detected:" + req.url));
        }
        return new Promise((resolve, reject)=>{
          var cb = (e, r, b)=> {
            if (e) {
              this.rnode.logger.error("Failed to proxy backend", e);
              reject(e);
              return;
            }
            //copy properties
            var targetProps = ["headers", "statusCode" ];
            targetProps.forEach((p)=>res[p] = r[p]);
            res.end(b);
            resolve(res);
          };

          var dstPath = String(req.url).substr(this.basePath.length-1);
          for (var i = 0; i < this.rewriteRule.length; i++) {
            if (this.rewriteRule[i].source.test(dstPath)) {
              dstPath = this.rewriteRule[i].dest;
              this.rnode.logger.info("Rewrite:" + req.url + " to " + dstPath);
              break;
            }
          }
          var url = "http://localhost:" + this.port + dstPath;
          var option = {
            url,
            headers: Object.assign({}, req.headers),
            encoding: null
          };
          this._convertBody(option,  req.body);
          if (method === "GET") {
            webClient.get(option, cb);
          } else {
            webClient.post(option, cb);
          }
        });
      })
  }
  _convertBody(option, body) {
    if (body == null) {
      return ;
    }
    if (typeof body === "object" && Object.keys(body).length === 0) {
      return ;
    }
    if (body instanceof Buffer || typeof body === "string") {
      option.body = body;
    } else {
      option.body = JSON.stringify(body);
    }
    if (option.headers) {
      delete option.headers["content-length"];

      // Body has already been decoded by core-node.
      delete option.headers["content-encoding"];
    }

  }
}
var rnode = new ResourceNode(coreNodeUrl, nodeClass);
rnode.registerServiceClasses({
  StaticFileServer
});
if (jwtToken) {
  rnode.setJWTAuthorization(jwtToken, jwtRefreshPath);
}
rnode.start()
  .then(() => {
    new SignalHandler(rnode);
    rnode.logger.info("Succeeded to start resource-node");
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
