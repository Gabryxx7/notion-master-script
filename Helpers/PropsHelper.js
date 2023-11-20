const PROP_TYPE = {
    title: 'title',
    text: 'text',
    rich_text: 'rich_text',
    status: 'status',
    checkbox: 'checkbox',
    select: 'select',
    multi_select: 'multi_select',
    unique_id: 'unique_id',
    created_by: 'created_by',
    link: 'link',
    url: 'url',
    number: 'number',
    formula: 'formula',
    name: 'name',
    date: 'date',
    people: 'people',
    created_time: 'created_time',
    last_edited_time: 'last_edited_time',
}

class PropsHelper{
    constructor(props){
        this.props = {};
        this.newProps = {};
        for(let k in props){
            const prop = props[k];
            this[k] = this.props[k] = this._get(prop);
        }
    }
    update(newProps){
        for(const [name, prop] of Object.entries(newProps)) {
            this.props[name] = newProps[name];
        }
    }
    isPropInDB(name){
        if(!this.props) return true;
        return name in this.props;
    }
    addStatus(name, statusName){
        if(!this.isPropInDB(name)) return this;
        if(!statusName) return this;
        this.newProps[name] = { status: { name: statusName}};
        return this;
    }
    addNumber(name, number){
        this.newProps[name] = { number: number };
        return this;
    }
    addCheckbox(name, ticked){
        if(!this.isPropInDB(name)) return this;
        this.newProps[name] = { checkbox: ticked };
        return this;
    }
    addRichText(name, textContent){
        if(!this.isPropInDB(name)) return this;
        if(!textContent) return this;
        this.newProps[name] = { rich_text: [{text: { content: textContent}}]};
        return this;
    }
    addTitle(name, textContent) {
        if(!this.isPropInDB(name)) return this;
        if(!textContent) return this;
        this.newProps[name] = { title: [{ text: { content: textContent }}] }
        return this;
    }
    addMultiSelect(name, namesList){
        if(!this.isPropInDB(name)) return this;
        if(!namesList) return this;
        this.newProps[name] = { multi_select: namesList}
        return this;
    }
    addSelect(name, selectedName) {
        if(!this.isPropInDB(name)) return this;
        if(!selectedName) return this;
        this.newProps[name] = { select: { name: selectedName}}
        return this;
    }
    addLink(name, url, as_text=false, title=null) {
        if(!title) title = url;
        if(as_text){
            if(!title) title = url;
            this.newProps[name] = { rich_text: [{text: { content: title, link: {url: url}}}]};
        }
        else{
            this.newProps[name] = {url: url}  
        }  
        return this;
    }

    get(name){
        const prop = !this.props[name];
        try{
            return this._get(prop)
        } catch(error){
            console.log(`Error getting property ${name} of type ${prop?.type}`, error);
        }
    }

    _get(data){
        switch(data?.type){
            case PROP_TYPE.checkbox:
                return data.checkbox;
            case PROP_TYPE.link:
            case PROP_TYPE.url:
                return data.url;
            case PROP_TYPE.title:
                return data.title?.map(block => this._get(block));
            case PROP_TYPE.name:
                return data.name;
            case PROP_TYPE.status:
                return data.status.name;
            case PROP_TYPE.select:
                return data.select.name;
            case PROP_TYPE.number:
                return data.number;
            case PROP_TYPE.rich_text:
                return data.rich_text?.map(block => this._get(block));
            case PROP_TYPE.text:
                return data.plain_text;
            case PROP_TYPE.created_by:
                return data.created_by?.name;
            case PROP_TYPE.people:
                return data.people?.map(person => person?.name);
            case PROP_TYPE.multi_select:
                return data.multi_select;
            case PROP_TYPE.unique_id:
                return data.unique_id.number;
            case PROP_TYPE.created_time:
                return Date.parse(data.created_time);
            case PROP_TYPE.last_edited_time:
                return Date.parse(data.last_edited_time);
            case PROP_TYPE.formula:
                return this._get(data.formula);
            default: return data;
        }

    }
    build(){
        const ret = {...this.newProps};
        this.newProps = {};
        return ret;
    }

    toString(){
        return this.props;
    }
    get [Symbol.toString]() {
        return this.props;
    }
    get [Symbol.toStringTag]() {
        return "PropsHelper";
    }
}

module.exports = { PropsHelper };