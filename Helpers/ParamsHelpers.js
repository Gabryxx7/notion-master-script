
class ParamsSchema{
    constructor(){
        this.paramsData = {};
    }
    addParam(name, needed, defaultVal=null){
        this.paramsData[name] = {"name": name, "needed": needed, "defaultVal": defaultVal}
        return this;
    }
    getParam(name){
        if(name in this.paramsData){
            return this.paramsData[name]
        }
        return null;
    }

    checkParams(params){
        for (const [paramName, sParam] of Object.entries(this.paramsData)) {
            if(!params.hasOwnProperty(sParam.name)){
                if(sParam.needed){
                    throw new Error(`${sParam.name} is required`);
                }
                params[sParam.name] = sParam.defaultVal;
            }
            else{
                var addedParams = [];
                if (params[sParam.name].constructor == Object){
                    for (const [defaultParamName, defaultParam] of Object.entries(sParam.defaultVal)){
                        if(!params[sParam.name].hasOwnProperty(defaultParamName)){
                            // console.log(`Adding default param: ${defaultParamName}`)
                            addedParams.push(defaultParamName)
                            params[sParam.name][defaultParamName] = defaultParam;
                        }
                    }
                }
                if(addedParams.length > 0){
                    console.log(`Added params: ${addedParams}`)
                }
            }
        }
        return params;
    }

    toString(){
        var str = {};
        for (const [paramName, sParam] of Object.entries(this.paramsData)) {
            str[paramName] = sParam.defaultVal ? sParam.defaultVal : "?"
        }
        return JSON.stringify(str, null, 2)
    }
}

module.exports = { ParamsSchema };