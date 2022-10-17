import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import yargs from 'yargs';

const argv = yargs(process.argv).argv as any;

const mainFile = './main.yaml' ?? argv.f;

const main = yaml.load(fs.readFileSync(mainFile, { encoding: 'utf-8' })) as any;

function resolveInclude(include: string | string[], variables: any): any {
  if (typeof include === 'string') {
    const path = replaceVariables(include, variables);
    if (fs.existsSync(path)) {
      return replaceVariables(yaml.load(fs.readFileSync(path, { encoding: 'utf8' })), variables)
    }
  } else if (Array.isArray(include)) {
    return include.reduce((acc: any, item: any) => {
      const path = replaceVariables(item, variables);
      if (fs.existsSync(path)) {
        acc = { ...acc, ...replaceVariables(yaml.load(fs.readFileSync(path, { encoding: 'utf8' })) as any, variables) }
        return acc;
      }
      return acc;
    }, { });
  }

  return undefined;
}

function replaceVariables(template: any, variables: any): any {
  if (typeof template === 'string') {
    for (const match of [...template.matchAll(/\{{\s*([A-Za-z_0-9]*)\s*}}/g)]) {
      template = template.replace(match[0], variables[match[1]] ?? '')
    }
    return template;
  }
  else if (!template || typeof template !== 'object') return template;
  else if (typeof template === 'object' && template._INCLUDE_) {
    return resolveInclude(template._INCLUDE_, variables) ?? { };
  }

  template = { ...template };
  
  for (const key in template) {
    const value = template[key];
    if (typeof value === "string") {
      if (/{{\s*([A-Za-z_0-9]*)\s*}}/.test(value)) {
        const match = value.match(/\{{\s*([A-Za-z_0-9]*)\s*}}/)!;
        const sub = variables[match[1]];
        if (!sub) {
          delete template[key];
        } else {
          template[key] = sub;
        }
      } else {
        template[key] = replaceVariables(template[key], variables)
      }
    } else if (typeof value === 'object' && value._INCLUDE_) {
      const includeResolved = resolveInclude(value._INCLUDE_, variables);
      if (!includeResolved) {
        delete template[key];
      } else {
        template[key] = includeResolved;
      }
    } else {
      template[key] = replaceVariables(template[key], variables);
    }
  }
  return template;
}

for (const deployment in main.deployments) {
  const variables = replaceVariables(main.deployments[deployment], { deployment });
  // NOTE: This special variable is auto updated
  variables.deployment = variables.deployment ?? deployment;
  for (const generatable of main.generate) {
    const mergedVariables = { ...variables, ...generatable.variables, ...generatable[deployment] };
    
    const filePath = replaceVariables(generatable.path, mergedVariables);
    const dir = path.join(filePath, '../');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    fs.writeFileSync(filePath, yaml.dump(replaceVariables(generatable.template, mergedVariables)), { encoding: 'utf8'});
    console.log(`✏ Written file ${filePath}`);
  }
}