#include "planner.hpp"
#include <filesystem>
#include <random>
#include <functional>
#define MF ReferenceMF
#include "../../include/full100_reference.hpp"
#undef MF
#include "grad.hpp"
struct Sample{State s;int episode=0,st=0,best=0;double q[6]={},value=0;};
std::vector<Sample> load(const std::string&path){std::ifstream f(path);if(!f)throw std::runtime_error("samples missing");std::string line;std::getline(f,line);std::vector<Sample>out;while(std::getline(f,line)){std::replace(line.begin(),line.end(),',',' ');std::istringstream z(line);Sample x;z>>x.episode>>x.st>>x.s.p>>x.s.t>>x.s.b>>x.s.n>>x.s.deck;for(int&i:x.s.h)z>>i;z>>x.best>>x.value;for(double&q:x.q)z>>q;if(!z)throw std::runtime_error("sample parse");out.push_back(x);}if(out.empty())throw std::runtime_error("no samples");return out;}
void fresh(const std::string&p){if(std::filesystem::exists(p))throw std::runtime_error("output exists: "+p);}
int collect(int ac,char**av){
 if(ac!=8)throw std::runtime_error("collect FULL100 games seed threads stride output.csv");fresh(av[7]);Full100 full(av[2]);int games=std::stoi(av[3]),threads=std::stoi(av[5]),stride=std::stoi(av[6]);uint32_t seed=std::stoul(av[4]);if(games<1||threads<1||stride<1)throw std::runtime_error("collect argument range");std::vector<std::string>rows(games);std::atomic<int>next{0};std::exception_ptr err;std::mutex mu;std::vector<std::thread>workers;
 for(int t=0;t<threads;t++)workers.emplace_back([&]{try{Planner p(full,2);for(;;){int ep=next++;if(ep>=games)break;State s;RNG rng(mix(seed+ep));std::ostringstream os;os<<std::setprecision(17);int st=0;while(!s.terminal()){int a=p.act(s);if(s.n&&st%stride==0){os<<ep<<','<<st<<','<<s.p<<','<<s.t<<','<<s.b<<','<<s.n<<','<<s.deck;for(int h:s.h)os<<','<<h;os<<','<<a<<','<<full.val(100-s.t,s.b,s.p,full.codec.hand(s),s.n);uint32_t seen=0;for(int j=0;j<6;j++){int c=j&&j<=s.n?full.codec.idmap[s.h[j-1]]:0;double q=-1e300;if(j<=s.n&&!(seen&(1u<<c))){seen|=1u<<c;q=p.Q(s,j,2);}os<<','<<q;}os<<'\n';}step(s,a,rng);if(++st>2048)throw std::runtime_error("decision bound");}rows[ep]=os.str();}}catch(...){std::lock_guard<std::mutex>lock(mu);if(!err)err=std::current_exception();next=games;}});
 for(auto&t:workers)t.join();if(err)std::rethrow_exception(err);std::ofstream f(av[7]);f<<"episode,step,p,t,b,n,deck,h0,h1,h2,h3,h4,best,value,q0,q1,q2,q3,q4,q5\n";for(auto&s:rows)f<<s;if(!f)throw std::runtime_error("collect output");return 0;
}
// 教师标签与 collect 相同；只有行为策略换成了冻结的学生模型。
int collect_student(int ac,char**av){
 if(ac!=9)throw std::runtime_error("collect_student FULL100 MODEL games seed threads stride output.csv");fresh(av[8]);fresh(std::string(av[8])+".meta.json");
 Full100 full(av[2]);Compact model(av[3]);int games=std::stoi(av[4]),threads=std::stoi(av[6]),stride=std::stoi(av[7]);uint32_t seed=std::stoul(av[5]);if(games<1||threads<1||stride<1)throw std::runtime_error("collect_student argument range");
 std::vector<std::string>rows(games);std::atomic<int>next{0};std::exception_ptr err;std::mutex mu;std::vector<std::thread>workers;
 for(int t=0;t<threads;t++)workers.emplace_back([&]{try{Planner teacher(full,2);FP<Compact>student(model,true);for(;;){int ep=next++;if(ep>=games)break;State s;RNG rng(mix(seed+ep));std::ostringstream os;os<<std::setprecision(17);int st=0;while(!s.terminal()){
  int action=student.act(s);if(s.n&&st%stride==0){int best=teacher.act(s);os<<ep<<','<<st<<','<<s.p<<','<<s.t<<','<<s.b<<','<<s.n<<','<<s.deck;for(int h:s.h)os<<','<<h;os<<','<<best<<','<<full.val(100-s.t,s.b,s.p,full.codec.hand(s),s.n);uint32_t seen=0;for(int j=0;j<6;j++){int c=j&&j<=s.n?full.codec.idmap[s.h[j-1]]:0;double q=-1e300;if(j<=s.n&&!(seen&(1u<<c))){seen|=1u<<c;q=teacher.Q(s,j,2);}os<<','<<q;}os<<'\n';}
  step(s,action,rng);if(++st>2048)throw std::runtime_error("decision bound");}rows[ep]=os.str();}}catch(...){std::lock_guard<std::mutex>lock(mu);if(!err)err=std::current_exception();next=games;}});
 for(auto&t:workers)t.join();if(err)std::rethrow_exception(err);std::ofstream f(av[8]);f<<"episode,step,p,t,b,n,deck,h0,h1,h2,h3,h4,best,value,q0,q1,q2,q3,q4,q5\n";for(auto&s:rows)f<<s;f.close();if(!f)throw std::runtime_error("collect_student output");
 auto quoted=[](const std::string&s){std::string out="\"";for(char c:s){if(c=='\\'||c=='\"')out+='\\';out+=c;}return out+'\"';};
 std::ofstream meta(std::string(av[8])+".meta.json");meta<<"{\"behavior\":\"frozen_student_reference_Q2\",\"teacher\":\"original_FULL100_reference_Q2\",\"behavior_model\":"<<quoted(av[3])<<",\"teacher_directory\":"<<quoted(av[2])<<",\"games\":"<<games<<",\"seed_base\":"<<seed<<",\"threads\":"<<threads<<",\"stride\":"<<stride<<",\"rng_contract\":\"mix(seed_base+episode)\",\"same_seed_as_teacher_is_same_episode_cluster\":true,\"new_independent_games_claimed\":false}\n";if(!meta)throw std::runtime_error("metadata output");return 0;
}
struct Metrics{double regret=0,p95=0,p99=0,maxregret=0,gapmae=0,value_mae=0,disagree=0;size_t n=0;};
Metrics validate(Compact&m,const std::vector<Sample>&xs,const std::string&detail=""){
 FP<Compact>p(m,true);Metrics z;z.n=xs.size();std::vector<double>loss;std::ofstream f;if(!detail.empty()){fresh(detail);f.open(detail);f<<"episode,step,r,n,deck_size,teacher,student,regret,value_error\n";f<<std::setprecision(17);}
 for(const auto&x:xs){int a=p.act(x.s);double l=x.q[x.best]-x.q[a];if(l< -1e-8||!std::isfinite(l))throw std::runtime_error("reference regret invalid");z.regret+=l;loss.push_back(l);z.maxregret=std::max(z.maxregret,l);z.disagree+=a!=x.best;for(int b=0;b<=x.s.n;b++)if(x.q[b]>-1e299)z.gapmae+=std::abs((p.qs[x.best]-p.qs[b])-(x.q[x.best]-x.q[b]));double e=m.val(100-x.s.t,x.s.b,x.s.p,m.codec.hand(x.s),x.s.n)-x.value;z.value_mae+=std::abs(e);if(f)f<<x.episode<<','<<x.st<<','<<100-x.s.t<<','<<x.s.n<<','<<__builtin_popcount(x.s.deck)<<','<<x.best<<','<<a<<','<<l<<','<<e<<'\n';}
 std::sort(loss.begin(),loss.end());z.p95=loss[size_t(.95*(loss.size()-1))];z.p99=loss[size_t(.99*(loss.size()-1))];z.regret/=z.n;z.disagree/=z.n;z.gapmae/=z.n;z.value_mae/=z.n;return z;
}
void json(std::ostream&f,const Metrics&m){f<<std::setprecision(17)<<"{\"states\":"<<m.n<<",\"mean_reference_q_loss\":"<<m.regret<<",\"p95_regret\":"<<m.p95<<",\"p99_regret\":"<<m.p99<<",\"max_regret\":"<<m.maxregret<<",\"disagreement\":"<<m.disagree<<",\"sum_gap_absolute_error_per_state\":"<<m.gapmae<<",\"root_value_mae\":"<<m.value_mae<<"}";}
int validate_cli(int ac,char**av){if(ac!=5)throw std::runtime_error("validate model states output.json");fresh(av[4]);Compact m(av[2]);auto z=validate(m,load(av[3]),std::string(av[4])+".csv");std::ofstream f(av[4]);json(f,z);f<<'\n';return 0;}
// 小幅归一化投影，围绕冻结的 epoch0 做逐分量信赖域。
double move(Grad&g,Compact&m,const std::vector<float>&init,double violation,double rate,double trust){double norm=0;for(auto i:g.touched)norm+=g.g[i]*g.g[i];if(norm<1e-14)return 0;double step=rate*violation/std::max(.05,norm),sq=0;for(auto i:g.touched){double lo=std::max(double(init[i])-trust,-32767.*m.gs),hi=std::min(double(init[i])+trust,32767.*m.gs);float v=float(std::clamp(double(m.GA[i])-step*g.g[i],lo,hi));sq+=(v-m.GA[i])*(v-m.GA[i]);m.GA[i]=v;}++m.revision;g.pi.cache.clear();return std::sqrt(sq);}
int train(int ac,char**av){
 if(ac!=10)throw std::runtime_error("train model train.csv validation.csv outprefix epochs rate trust_absolute anchor_rate");std::string prefix=av[5];fresh(prefix+"_selection.json");Compact m(av[2]);auto xs=load(av[3]),vs=load(av[4]);m.dequant();auto init=m.GA;std::vector<double>anchor;for(auto&x:xs)anchor.push_back(m.val(100-x.s.t,x.s.b,x.s.p,m.codec.hand(x.s),x.s.n));int epochs=std::stoi(av[6]);double rate=std::stod(av[7]),trust=std::stod(av[8]),arate=std::stod(av[9]);if(epochs<1||rate<=0||rate>1||trust<=0||arate<0||arate>1)throw std::runtime_error("train range");FP<Compact>p(m,true);Grad g(m,p);std::vector<size_t>order(xs.size());std::iota(order.begin(),order.end(),0);std::mt19937 rng(352020001);std::vector<Metrics>metrics;std::vector<std::string>files;
 {Compact original(av[2]);metrics.push_back(validate(original,vs,prefix+"_e0.validation.csv"));files.push_back(av[2]);}
 int best=0;for(int ep=1;ep<=epochs;ep++){std::shuffle(order.begin(),order.end(),rng);double hinge=0,drift=0;size_t updates=0;for(size_t i:order){auto&x=xs[i];p.act(x.s);double violation=0;int c=x.best;for(int a=0;a<=x.s.n;a++)if(x.q[a]>-1e299){double v=x.q[x.best]-x.q[a]+p.qs[a]-p.qs[x.best];if(v>violation){violation=v;c=a;}}hinge+=violation;
   if(c!=x.best&&violation>1e-9){g.clear();g.q(x.s,c,2,1);g.q(x.s,x.best,2,-1);drift+=move(g,m,init,violation,rate,trust);++updates;}
   double v=m.val(100-x.s.t,x.s.b,x.s.p,m.codec.hand(x.s),x.s.n);g.clear();g.leaf(x.s,1);move(g,m,init,v-anchor[i],arate,trust);
  }
  for(size_t j=0;j<m.GA.size();j++)m.GA[j]=.99f*m.GA[j]+.01f*init[j];++m.revision;std::string file=prefix+"_e"+std::to_string(ep)+".bin";fresh(file);m.save(file);files.push_back(file);
  {Compact reload(file);metrics.push_back(validate(reload,vs,prefix+"_e"+std::to_string(ep)+".validation.csv"));}
  if(metrics[ep].regret<metrics[best].regret-1e-12||(std::abs(metrics[ep].regret-metrics[best].regret)<=1e-12&&metrics[ep].p99<metrics[best].p99))best=ep;
  std::cerr<<"epoch="<<ep<<" hinge="<<hinge/xs.size()<<" updates="<<updates<<" parameter_path="<<drift<<" validation_regret="<<metrics[ep].regret<<std::endl;
 }
 std::ofstream out(prefix+"_selection.json");out<<"{\"objective\":\"teacher_regret_multiclass_margin\",\"teacher\":\"frozen_FULL100_reference_Q2\",\"epoch0_included\":true,\"best_epoch\":"<<best<<",\"epochs\":[";for(size_t i=0;i<metrics.size();i++){if(i)out<<',';out<<"{\"epoch\":"<<i<<",\"metrics\":";json(out,metrics[i]);out<<'}';}out<<"]}\n";std::cout<<"selected_epoch="<<best<<" file="<<files[best]<<std::endl;return 0;
}
int gradient_check(int ac,char**av){
 if(ac!=5)throw std::runtime_error("gradient_check model states output.json");fresh(av[4]);Compact m(av[2]);m.dequant();FP<Compact>p(m,true);Grad g(m,p);auto xs=load(av[3]);double maxerr=0;int tests=0;for(size_t k=0;k<xs.size()&&tests<16;k+=std::max(size_t(1),xs.size()/16)){auto&x=xs[k];p.act(x.s);int a=x.best,c=a==0?1:0;if(x.q[c]<-1e299)continue;g.clear();g.q(x.s,a,2,1);g.q(x.s,c,2,-1);double norm=0;for(auto i:g.touched)norm+=g.g[i]*g.g[i];if(norm<1e-8)continue;std::vector<float>old;for(auto i:g.touched)old.push_back(m.GA[i]);auto probe=[&](double sign){for(size_t j=0;j<g.touched.size();j++)m.GA[g.touched[j]]=old[j]+sign*.02*g.g[g.touched[j]]/sqrt(norm);++m.revision;p.act(x.s);return p.qs[a]-p.qs[c];};double up=probe(1),dn=probe(-1);maxerr=std::max(maxerr,std::abs((up-dn)/.04-sqrt(norm))/std::max(1.,sqrt(norm)));for(size_t j=0;j<g.touched.size();j++)m.GA[g.touched[j]]=old[j];++m.revision;++tests;}
 std::ofstream f(av[4]);f<<"{\"tests\":"<<tests<<",\"max_normalized_derivative_error\":"<<maxerr<<",\"passed\":"<<(tests&&maxerr<.02?"true":"false")<<"}\n";return tests&&maxerr<.02?0:1;
}
int main(int ac,char**av){try{if(ac<2)throw std::runtime_error("command");std::string cmd=av[1];if(cmd=="collect")return collect(ac,av);if(cmd=="collect_student")return collect_student(ac,av);if(cmd=="validate")return validate_cli(ac,av);if(cmd=="train")return train(ac,av);if(cmd=="gradient_check")return gradient_check(ac,av);throw std::runtime_error("unknown command");}catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
