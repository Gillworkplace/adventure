#include "engine_factor.hpp"
#include "exact_dp.hpp"
#include <filesystem>
#include <sstream>
using Clock=std::chrono::steady_clock;
static double sec(Clock::time_point t){return std::chrono::duration<double>(Clock::now()-t).count();}
static std::string optionalMetric(double value,bool supported){if(!supported)return "null";std::ostringstream out;out<<std::setprecision(17)<<value;return out.str();}
struct QS{std::array<double,6>q;std::vector<int>a;int best=0;double gap=1e300;};
template<class P>QS inspect(P&p,const State&s,int d){
 QS z;z.q.fill(-1e300);uint32_t seen=0;int h=p.M.codec.hand(s);
 for(int a=0;a<=s.n;a++){int c=a?p.M.codec.idmap[s.h[a-1]]:0;if(seen&(1u<<c))continue;seen|=1u<<c;z.a.push_back(a);z.q[a]=p.Q(s,a,d,h);}
 std::stable_sort(z.a.begin(),z.a.end(),[&](int a,int b){return z.q[a]>z.q[b];});z.best=z.a[0];if(z.a.size()>1)z.gap=z.q[z.a[0]]-z.q[z.a[1]];return z;
}
struct Counts{
 uint64_t calls=0,withHand=0,deep3=0,deep4=0,cap3=0,cap4=0,terminal=0,terminalCap=0,changed=0,roundoff=0;
 uint64_t byR[5][4]={};
 Counts&operator+=(const Counts&o){calls+=o.calls;withHand+=o.withHand;deep3+=o.deep3;deep4+=o.deep4;cap3+=o.cap3;cap4+=o.cap4;terminal+=o.terminal;terminalCap+=o.terminalCap;changed+=o.changed;roundoff+=o.roundoff;for(int i=0;i<5;i++)for(int j=0;j<4;j++)byR[i][j]+=o.byR[i][j];return *this;}
};
struct Candidate {
 OptPlanner<true>p;ExactDP terminalDP;std::string mode;Counts c;
 int lastDepth=0,lastBase=0;double lastGap=1e300;
 Candidate(Compact100&m,Meta&t,std::string md,double gamma):p(m,t,"base",true,true),terminalDP(m,Stop::Terminal,5000),mode(md){p.gamma=gamma;}
 void invalidate(){if(++p.epoch==0){for(auto&tab:p.tt)for(auto&e:tab)e.gen=0;p.epoch=1;}}
 QS raw(const State&s,int d){p.rawMode=true;invalidate();try{auto z=inspect(p,s,d);p.rawMode=false;invalidate();++c.roundoff;return z;}catch(...){p.rawMode=false;invalidate();throw;}}
 QS checked(const State&s,int d,double gate=-1){
  auto z=inspect(p,s,d);double e=2*p.M.factorBound*(1+4*p.gamma);
  if(z.gap<=e||(gate>=0&&std::abs(z.gap-gate)<=e))z=raw(s,d);return z;
 }
 int act(const State&s){
  ++c.calls;lastDepth=0;lastGap=1e300;lastBase=0;if(!s.n)return 0;++c.withHand;
  p.clear();p.setBudget(0);int r=100-s.t,nd=__builtin_popcount(s.deck),bin=std::min(4,std::max(0,r-1)/20);++c.byR[bin][0];
  double gate=mode=="full1"?1.:mode=="event"?(nd<=8?1.:-1.):mode=="joint"?((nd<=8&&s.n>=2)?2.:.5):-1.;
  auto two=checked(s,2,gate);int ans=two.best;lastBase=ans;lastGap=two.gap;lastDepth=2;
  if(mode=="base")return ans;
  if((mode=="event"&&r<=1)||(mode=="joint"&&r<=2)){
   double v;std::array<double,6>q;try{ans=terminalDP.inspect(s,0,v,q);++c.terminal;lastDepth=1000;c.changed+=ans!=two.best;return ans;}catch(const Limit&){++c.terminalCap;}
  }
  if(gate<0||two.gap>gate)return ans;
  ++c.byR[bin][1];p.setBudget(mode=="joint"?12000:0);QS three;
  try{three=checked(s,3,mode=="joint"&&nd<=6&&s.n>=3?.25:-1.);++c.deep3;lastDepth=3;ans=three.best;}
  catch(const SearchLimit&){++c.cap3;++c.byR[bin][3];p.setBudget(0);return ans;}
  p.setBudget(0);
  if(mode=="joint"&&three.gap<=.25&&nd<=6&&s.n>=3){p.setBudget(12000);try{auto four=checked(s,4);ans=four.best;++c.deep4;lastDepth=4;}catch(const SearchLimit&){++c.cap4;}p.setBudget(0);}
  if(ans!=two.best){++c.changed;++c.byR[bin][2];}return ans;
 }
};
static double cpu(){FILETIME c,e,k,u;GetProcessTimes(GetCurrentProcess(),&c,&e,&k,&u);ULARGE_INTEGER a,b;a.LowPart=k.dwLowDateTime;a.HighPart=k.dwHighDateTime;b.LowPart=u.dwLowDateTime;b.HighPart=u.dwHighDateTime;return (a.QuadPart+b.QuadPart)*1e-7;}
struct Rec{int score=0,steps=0;uint64_t hash=1469598103934665603ULL;};
struct Timing{std::vector<double>all,hand;};
template<class P>Rec game(P&p,uint32_t seed,Timing*timing=nullptr,std::ostream*states=nullptr,int ep=0){
 State s;RNG rng(seed);Rec z;while(!s.terminal()){
  auto t=Clock::now();int a=p.act(s);if(timing){double ms=sec(t)*1000;timing->all.push_back(ms);if(s.n)timing->hand.push_back(ms);}
  if(states&&s.n){*states<<ep<<','<<z.steps<<','<<s.p<<','<<100-s.t<<','<<s.b<<','<<s.n;for(int j=0;j<5;j++)*states<<','<<s.h[j];*states<<','<<s.deck<<','<<a<<','<<p.lastBase<<','<<p.lastGap<<','<<p.lastDepth<<'\n';}
  z.hash^=uint64_t(a+1);z.hash*=1099511628211ULL;step(s,a,rng);if(++z.steps>2048)throw std::runtime_error("episode bound");
 }z.score=s.p;return z;
}
static std::string timings(std::vector<double>v){
 if(v.empty())return "null";std::sort(v.begin(),v.end());double sum=0;uint64_t over100=0,over200=0,over800=0;for(double x:v){sum+=x;over100+=x>=100;over200+=x>=200;over800+=x>=800;}
 auto q=[&](double f){double x=f*(v.size()-1);size_t k=size_t(x);return v[k]+(x-k)*(v[std::min(k+1,v.size()-1)]-v[k]);};
 std::ostringstream j;j<<std::setprecision(17)<<"{\"n\":"<<v.size()<<",\"mean_ms\":"<<sum/v.size()<<",\"p50_ms\":"<<q(.5)<<",\"p95_ms\":"<<q(.95)<<",\"p99_ms\":"<<q(.99)<<",\"max_ms\":"<<v.back()<<",\"over100ms\":"<<over100<<",\"over200ms\":"<<over200<<",\"over800ms\":"<<over800<<"}";return j.str();
}
static void bench(Compact100&M,Meta&T,int n,uint32_t seed,int th,const std::string&mode,double gamma,const std::string&out,bool latency){
 std::vector<Rec>rows(n);std::atomic<int>next{0},done{0};std::mutex mu;std::exception_ptr error;std::vector<std::thread>w;Counts c;Timing timing;
 uint64_t lc=0,rb=0,hits=0,miss=0,hdBuilds=0,hdHits=0;auto start=Clock::now();double c0=cpu();std::ofstream states;
 if(latency){if(th!=1)throw std::runtime_error("latency requires one worker");states.open(out+".states.csv");states<<std::setprecision(17)<<"episode,decision,p,r,b,n,h0,h1,h2,h3,h4,deck,action,base_action,gap2,depth\n";}
 for(int t=0;t<th;t++)w.emplace_back([&]{try{
  Candidate p(M,T,mode,gamma);
  for(;;){int i=next++;if(i>=n)break;rows[i]=game(p,mix(seed+uint32_t(i)),latency?&timing:nullptr,latency?&states:nullptr,i);int d=++done;if(d%1000==0){std::lock_guard<std::mutex>g(mu);std::cerr<<mode<<" "<<d<<"/"<<n<<" elapsed="<<sec(start)<<std::endl;}}
  std::lock_guard<std::mutex>g(mu);c+=p.c;lc+=LC;rb+=RB;hits+=p.p.stat.hits;miss+=p.p.stat.misses;hdBuilds+=p.p.hd.builds;hdHits+=p.p.hd.hits;
 }catch(...){std::lock_guard<std::mutex>g(mu);error=std::current_exception();next=n;}});
 for(auto&x:w)x.join();if(error)std::rethrow_exception(error);double elapsed=sec(start),cp=cpu()-c0;long double sum=0,sq=0;uint64_t steps=0;std::ofstream f(out);if(!f)throw std::runtime_error("output");f<<"episode,seed,score,steps,hash\n";
 for(int i=0;i<n;i++){auto&z=rows[i];sum+=z.score;sq+=(long double)z.score*z.score;steps+=z.steps;f<<i<<','<<mix(seed+uint32_t(i))<<','<<z.score<<','<<z.steps<<','<<z.hash<<'\n';}f.close();if(!f)throw std::runtime_error("write");
 PROCESS_MEMORY_COUNTERS pm{};GetProcessMemoryInfo(GetCurrentProcess(),&pm,sizeof(pm));std::ostringstream j;j<<std::setprecision(17)<<"{\"policy\":\""<<mode<<"\",\"opt\":"<<OPT<<",\"hd_gamma\":"<<gamma<<",\"n\":"<<n<<",\"seed_base\":"<<seed<<",\"threads\":"<<th<<",\"mean\":"<<double(sum/n)<<",\"sd\":"<<sqrt(double((sq-sum*sum/n)/(n-1)))<<",\"seconds\":"<<elapsed<<",\"cpu_seconds\":"<<cp<<",\"steps\":"<<steps<<",\"calls\":"<<c.calls<<",\"with_hand\":"<<c.withHand<<",\"depth3_completed\":"<<c.deep3<<",\"depth4_completed\":"<<c.deep4<<",\"depth3_cap\":"<<c.cap3<<",\"depth4_cap\":"<<c.cap4<<",\"terminal_solved\":"<<c.terminal<<",\"terminal_cap\":"<<c.terminalCap<<",\"changed_vs_local_q2\":"<<c.changed<<",\"roundoff_fallbacks\":"<<c.roundoff<<",\"leaf_calls\":"<<lc<<",\"row_builds\":"<<rb<<",\"tt_hits\":"<<hits<<",\"tt_misses\":"<<miss<<",\"hd_builds\":"<<hdBuilds<<",\"hd_hits\":"<<hdHits<<",\"peak_MiB\":"<<pm.PeakWorkingSetSize/1048576.<<",\"latency_all\":"<<timings(timing.all)<<",\"latency_with_hand\":"<<timings(timing.hand)<<",\"r_bins\":[";
 for(int i=0;i<5;i++){if(i)j<<',';j<<'[';for(int k=0;k<4;k++){if(k)j<<',';j<<c.byR[i][k];}j<<']';}j<<"]}";
 std::ofstream jf(out+".json");jf<<j.str()<<'\n';std::cout<<j.str()<<std::endl;
}
static void audit(Compact100&M,Meta&T,int n,uint32_t seed,const std::string&out){
 FastPlanner<true>ref(M,T,"base",true,true);Candidate cand(M,T,"base",0);OptPlanner<true>hd(M,T,"base",true,true);hd.gamma=M.L?0:.5;bool hdSupported=M.L==0;
 ExactDP exact(M,Stop::Decision,100000);exact.ungrouped=true;exact.verifyRank=true;
 uint64_t checks=0;double factorErr=0,hdDirectErr=0,hdDrawErr=0,hdQErr=0,transitionErr=0;int am=0,states=0;
 for(int ep=0;states<n;ep++){State s;RNG rng(mix(seed+uint32_t(ep)));int d=0;while(!s.terminal()&&states<n){
  if(s.n&&(d++%17==0)){
   ref.clear();cand.p.clear();hd.clear();auto dc=hd.makeContext(s.deck);int h=M.codec.hand(s),r=100-s.t;
   if(hdSupported)hdDirectErr=std::max(hdDirectErr,std::abs(hd.hd.value(r,s.b,s.p,h,dc)-hd.hd.direct(r,s.b,s.p,h,dc)));
   if(hdSupported&&s.n<5){long double manual=0;for(int j=0;j<dc.k;j++){auto next=HDTail::nextDeck(dc,dc.c[j],M);manual+=(long double)dc.count[j]*hd.hd.value(r,s.b,s.p,T.hands[h].add[dc.c[j]],next);}hdDrawErr=std::max(hdDrawErr,std::abs(double(manual/dc.n)-hd.hd.value(r,s.b,s.p,h,dc,true)));}
   for(int a=0;a<=s.n;a++){double x=ref.Q(s,a,2),y=cand.p.Q(s,a,2);factorErr=std::max(factorErr,std::abs(x-y));++checks;}
   am+=ref.act(s)!=cand.act(s);
   auto qfast=inspect(hd,s,2);hd.rawMode=true;hd.clear();auto qraw=inspect(hd,s,2);hd.rawMode=false;hd.clear();for(int a:qfast.a)hdQErr=std::max(hdQErr,std::abs(qfast.q[a]-qraw.q[a]));
   if(states<8){exact.clear();for(int a:qfast.a)transitionErr=std::max(transitionErr,std::abs(exact.Q(s,a,2)-ref.Q(s,a,2)));}
   // Synthetic last-card/reset and repeated-class cases exercise the same algebra.
   if(hdSupported&&s.n<5){for(int c:{1,4,15,22}){auto one=hd.makeContext(1u<<(M.codec.representative[c]-1));auto next=HDTail::nextDeck(one,c,M);if(next.n!=30)throw std::runtime_error("reset");hdDirectErr=std::max(hdDirectErr,std::abs(hd.hd.value(r,s.b,s.p,h,one)-hd.hd.direct(r,s.b,s.p,h,one)));}}
   ++states;
  }step(s,ref.act(s),rng);
 }}
 bool ok=am==0&&factorErr<=M.factorBound&&transitionErr<1e-8&&(!hdSupported||(hdDirectErr<=M.factorBound*4&&hdDrawErr<1e-8&&hdQErr<=M.factorBound*3));
 std::ostringstream j;j<<std::setprecision(17)<<"{\"ok\":"<<(ok?"true":"false")<<",\"states\":"<<states<<",\"q_checks\":"<<checks<<",\"base_action_mismatches\":"<<am<<",\"factor_max_q_error\":"<<factorErr<<",\"hd_formula_max_error\":"<<optionalMetric(hdDirectErr,hdSupported)<<",\"hd_chance_factor_max_error\":"<<optionalMetric(hdDrawErr,hdSupported)<<",\"hd_raw_q_max_error\":"<<optionalMetric(hdQErr,hdSupported)<<",\"hd_supported\":"<<(hdSupported?"true":"false")<<",\"ungrouped_transition_max_error\":"<<transitionErr<<",\"factor_guard\":"<<M.factorBound<<"}";
 std::ofstream f(out);f<<j.str()<<'\n';std::cout<<j.str()<<std::endl;if(!ok)throw std::runtime_error("audit failed");
}
int main(int ac,char**av){try{
 if(ac!=9)throw std::runtime_error("model n seed threads policy gamma task output");
 int n=std::stoi(av[2]),th=std::stoi(av[4]);uint32_t seed=std::stoul(av[3]);std::string mode=av[5],task=av[7],out=av[8];double gamma=std::stod(av[6]);
 if(n<2||th<1||th>12||(mode!="base"&&mode!="full1"&&mode!="event"&&mode!="joint")||(gamma!=0&&gamma!=.5))throw std::runtime_error("arguments");
 if(std::filesystem::exists(out)||std::filesystem::exists(out+".json"))throw std::runtime_error("output exists");
 OPT=4228;Compact100 M(av[1]);Meta T(M);if(M.L&&gamma!=0)throw std::runtime_error("gamma must be zero for local residual models");if(!M.L&&(gamma||task=="audit"))HDTail::prepare(M,T);std::cerr<<"factor_bound="<<M.factorBound<<std::endl;
 if(task=="audit")audit(M,T,n,seed,out);else if(task=="bench"||task=="latency")bench(M,T,n,seed,th,mode,gamma,out,task=="latency");else throw std::runtime_error("task");return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
